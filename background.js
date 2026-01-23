// Affinity Stealth Adder - Background Service Worker

const AFFINITY_API_BASE = 'https://api.affinity.co';

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addToAffinity') {
    handleAddToAffinity(request.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
  if (request.action === 'checkDuplicate') {
    checkForDuplicate(request.data)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ exists: false, error: error.message }));
    return true;
  }
});

async function handleAddToAffinity(data) {
  // Get stored credentials
  const settings = await chrome.storage.sync.get(['affinityApiKey', 'affinityListId', 'affinityTenantSubdomain', 'affinityUserEmail']);

  if (!settings.affinityApiKey || !settings.affinityListId) {
    throw new Error('Please configure your Affinity API key and List ID in the extension settings.');
  }

  try {
    // Get current user (for owner assignment)
    const currentUser = await getCurrentUser(settings.affinityApiKey, settings.affinityUserEmail);
    console.log('Current user:', currentUser);

    let organization, person, listEntry;

    if (data.type === 'linkedin_profile') {
      // LinkedIn profile flow - create Stealth org with person
      const { fullName, linkedinUrl } = data;
      const orgName = `Stealth_${fullName}`;

      // Parse name into first and last
      const nameParts = fullName.split(' ');
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(' ') || firstName;

      // Create the organization
      organization = await createOrganization(settings.affinityApiKey, orgName, null);
      console.log('Created organization:', organization);

      // Create the person
      person = await createPerson(settings.affinityApiKey, firstName, lastName, linkedinUrl);
      console.log('Created/found person:', person);

      // Link person to organization
      await linkPersonToOrganization(settings.affinityApiKey, person.id, organization.id);
      console.log('Linked person to organization');

    } else {
      // Website flow - create org with domain
      const { companyName, domain, url } = data;

      // Create the organization with domain
      organization = await createOrganization(settings.affinityApiKey, companyName, domain);
      console.log('Created organization:', organization);
    }

    // Add organization to the deal list
    listEntry = await addToList(settings.affinityApiKey, settings.affinityListId, organization.id);
    console.log('Added to list:', listEntry);

    // Set owner on the list entry
    if (currentUser && listEntry) {
      await setListEntryOwner(settings.affinityApiKey, settings.affinityListId, listEntry.id, organization.id, currentUser);
      console.log('Set owner to:', currentUser.first_name, currentUser.last_name);
    }

    // Add note if provided
    if (data.note && data.note.trim()) {
      await addNote(settings.affinityApiKey, organization.id, data.note.trim());
      console.log('Added note');
    }

    // Build Affinity URL
    const affinityUrl = `https://${settings.affinityTenantSubdomain}.affinity.co/companies/${organization.id}`;

    return {
      success: true,
      organization: organization,
      person: person || null,
      listEntry: listEntry,
      owner: currentUser,
      affinityUrl: affinityUrl
    };
  } catch (error) {
    console.error('Affinity API Error:', error);
    throw error;
  }
}

async function checkForDuplicate(data) {
  const settings = await chrome.storage.sync.get(['affinityApiKey', 'affinityTenantSubdomain']);
  if (!settings.affinityApiKey) {
    return { exists: false };
  }

  const apiKey = settings.affinityApiKey;
  let searchTerm = '';

  if (data.type === 'linkedin_profile') {
    searchTerm = `Stealth_${data.fullName}`;
  } else {
    searchTerm = data.domain || data.companyName;
  }

  try {
    // Search for existing organization
    const response = await fetch(`${AFFINITY_API_BASE}/organizations?term=${encodeURIComponent(searchTerm)}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const result = await response.json();
      const orgs = result.organizations || result;
      if (Array.isArray(orgs) && orgs.length > 0) {
        // Check for exact match on domain or name
        const exactMatch = orgs.find(org =>
          (data.domain && org.domain === data.domain) ||
          org.name === searchTerm ||
          org.name === data.companyName
        );
        if (exactMatch) {
          return {
            exists: true,
            organization: exactMatch,
            affinityUrl: `https://${settings.affinityTenantSubdomain}.affinity.co/companies/${exactMatch.id}`
          };
        }
      }
    }
  } catch (e) {
    console.log('Duplicate check failed:', e);
  }

  return { exists: false };
}

async function getCurrentUser(apiKey, userEmail) {
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/whoami`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const user = await response.json();
      console.log('Whoami response (full):', JSON.stringify(user));

      // Use the email from settings to find the person record
      const emailToSearch = userEmail || user.email;
      console.log('Looking up person by email:', emailToSearch);

      if (emailToSearch) {
        const personId = await findInternalPersonByEmail(apiKey, emailToSearch);
        if (personId) {
          user.person_id = personId;
          console.log('Found person_id:', personId);
        }
      }

      // Also try to get from /users endpoint which may have person_id
      if (!user.person_id) {
        const teamMember = await findTeamMemberById(apiKey, user.user_id);
        if (teamMember && teamMember.person_id) {
          user.person_id = teamMember.person_id;
        }
      }

      return user;
    }
  } catch (e) {
    console.log('Failed to get current user:', e);
  }
  return null;
}

async function findTeamMemberById(apiKey, userId) {
  try {
    // Try to get user details which might include person_id
    const response = await fetch(`${AFFINITY_API_BASE}/users/${userId}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const user = await response.json();
      console.log('User details:', user);
      return user;
    }
  } catch (e) {
    console.log('Failed to get user details:', e);
  }

  // Try listing all users to find matching one
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/users`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const users = await response.json();
      console.log('All users:', users);
      const match = users.find(u => u.id === userId || u.user_id === userId);
      if (match) {
        return match;
      }
    }
  } catch (e) {
    console.log('Failed to list users:', e);
  }

  return null;
}

async function findInternalPersonByEmail(apiKey, email) {
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/persons?term=${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Person search results for', email, ':', data);
      const persons = data.persons || data;
      if (Array.isArray(persons) && persons.length > 0) {
        // Find exact email match
        const match = persons.find(p =>
          p.emails && p.emails.some(e => e.toLowerCase() === email.toLowerCase())
        );
        if (match) {
          console.log('Found internal person:', match);
          return match.id;
        }
        // If no exact match, return first result
        console.log('Using first person result:', persons[0]);
        return persons[0].id;
      }
    }
  } catch (e) {
    console.log('Failed to find internal person:', e);
  }
  return null;
}

async function setListEntryOwner(apiKey, listId, listEntryId, organizationId, currentUser) {
  try {
    // Get fields - try list-specific endpoint first, then fall back to global fields
    let fields = await getListFields(apiKey, listId);

    if (!fields || fields.length === 0) {
      console.log('No fields found for list', listId);
      return;
    }

    console.log('List fields:', fields.map(f => ({ name: f.name, id: f.id, value_type: f.value_type })));

    // Find the Owners field - must match exactly "Owners" or "Owner"
    const ownerField = fields.find(f =>
      f.name.toLowerCase() === 'owners' ||
      f.name.toLowerCase() === 'owner'
    );

    if (!ownerField) {
      console.log('Owner field not found in list. Available fields:', fields.map(f => f.name));
      return;
    }

    console.log('Found owner field:', ownerField);

    // Try different ID values - person_id first (that's what Owners field needs)
    const ownerIdsToTry = [
      currentUser.person_id,      // Internal person ID - most likely to work for Owners field
      currentUser.user_id,        // User ID from whoami response
      currentUser.id,             // Fallback if structure different
      currentUser.grant_id        // Grant ID if available
    ].filter(Boolean);

    console.log('Trying owner IDs:', ownerIdsToTry);
    console.log('List entry ID:', listEntryId);
    console.log('Owner field ID:', ownerField.id);

    for (const ownerId of ownerIdsToTry) {
      try {
        // For list-specific fields, need both entity_id (org) and list_entry_id
        const requestBody = {
          field_id: ownerField.id,
          entity_id: organizationId,
          list_entry_id: listEntryId,
          value: ownerId
        };
        console.log('Setting field value with:', requestBody);

        const response = await fetch(`${AFFINITY_API_BASE}/field-values`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(':' + apiKey),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestBody)
        });

        const responseText = await response.text();
        console.log('Field value response:', response.status, responseText);

        if (response.ok) {
          console.log('Owner set successfully with owner_id:', ownerId);
          return;
        }
      } catch (e) {
        console.log('Error trying owner_id', ownerId, ':', e);
      }
    }

    console.log('All owner ID attempts failed');
  } catch (e) {
    console.log('Failed to set owner:', e);
  }
}

async function getListFields(apiKey, listId) {
  // Try list-specific endpoint first
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/lists/${listId}/fields`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return await response.json();
    }
    console.log('List fields endpoint failed:', response.status);
  } catch (e) {
    console.log('List fields request error:', e);
  }

  // Fall back to global fields endpoint - but ONLY get fields for this specific list
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/fields`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const allFields = await response.json();
      // ONLY return fields that belong to this specific list (not global fields)
      const listFields = allFields.filter(f =>
        f.list_id === parseInt(listId) || f.list_id === listId
      );
      console.log('Fields for list', listId, ':', listFields.map(f => ({ name: f.name, id: f.id })));
      return listFields;
    }
  } catch (e) {
    console.log('Global fields request error:', e);
  }

  return [];
}

async function createOrganization(apiKey, name, domain) {
  const body = { name };
  if (domain) {
    body.domain = domain;
  }

  const response = await fetch(`${AFFINITY_API_BASE}/organizations`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(':' + apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to create organization: ${errorData.message || response.statusText}`);
  }

  return response.json();
}

async function createPerson(apiKey, firstName, lastName, linkedinUrl) {
  // First, try to find existing person by LinkedIn URL
  const existingPerson = await findPersonByLinkedIn(apiKey, linkedinUrl);

  if (existingPerson) {
    return existingPerson;
  }

  // Create new person
  const response = await fetch(`${AFFINITY_API_BASE}/persons`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(':' + apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to create person: ${errorData.message || response.statusText}`);
  }

  const person = await response.json();

  // Add LinkedIn URL as a field
  await addLinkedInField(apiKey, person.id, linkedinUrl);

  return person;
}

async function linkPersonToOrganization(apiKey, personId, organizationId) {
  // Method 1: Update organization with person_ids
  try {
    await fetch(`${AFFINITY_API_BASE}/organizations/${organizationId}`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        person_ids: [personId]
      })
    });
  } catch (e) {
    console.log('Method 1 (update org) failed:', e);
  }

  // Method 2: Update person with organization_ids
  try {
    await fetch(`${AFFINITY_API_BASE}/persons/${personId}`, {
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        organization_ids: [organizationId]
      })
    });
  } catch (e) {
    console.log('Method 2 (update person) failed:', e);
  }

  // Method 3: Create an organization-person relationship via relationship strengths
  try {
    await fetch(`${AFFINITY_API_BASE}/relationship-strengths`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        internal_id: personId,
        external_id: organizationId,
        strength: 5
      })
    });
  } catch (e) {
    console.log('Method 3 (relationship) failed:', e);
  }
}

async function findPersonByLinkedIn(apiKey, linkedinUrl) {
  // Search for person with this LinkedIn URL
  // Note: This is a simplified search - Affinity's search might work differently
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/persons?term=${encodeURIComponent(linkedinUrl)}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      if (data.persons && data.persons.length > 0) {
        return data.persons[0];
      }
    }
  } catch (e) {
    console.log('Person search failed, will create new:', e);
  }

  return null;
}

async function addLinkedInField(apiKey, personId, linkedinUrl) {
  // This adds the LinkedIn URL to the person's profile
  // Affinity stores LinkedIn as a social profile field
  // The exact implementation depends on your Affinity field configuration
  try {
    // Get available fields for persons to find LinkedIn field
    const fieldsResponse = await fetch(`${AFFINITY_API_BASE}/persons/fields`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (fieldsResponse.ok) {
      const fields = await fieldsResponse.json();
      const linkedinField = fields.find(f =>
        f.name.toLowerCase().includes('linkedin') ||
        f.value_type === 'linkedin'
      );

      if (linkedinField) {
        await fetch(`${AFFINITY_API_BASE}/field-values`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(':' + apiKey),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            field_id: linkedinField.id,
            entity_id: personId,
            value: linkedinUrl
          })
        });
      }
    }
  } catch (e) {
    console.log('Failed to add LinkedIn field:', e);
  }
}

async function addNote(apiKey, organizationId, noteContent) {
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/notes`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        organization_ids: [organizationId],
        content: noteContent
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log('Failed to add note:', errorData);
    }
  } catch (e) {
    console.log('Failed to add note:', e);
  }
}

async function addToList(apiKey, listId, organizationId) {
  const response = await fetch(`${AFFINITY_API_BASE}/lists/${listId}/list-entries`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(':' + apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      entity_id: organizationId,
      entity_type: 0 // 0 = Organization, 1 = Person
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(`Failed to add to list: ${errorData.message || response.statusText}`);
  }

  return response.json();
}
