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
});

async function handleAddToAffinity(profileData) {
  // Get stored credentials
  const settings = await chrome.storage.sync.get(['affinityApiKey', 'affinityListId']);

  if (!settings.affinityApiKey || !settings.affinityListId) {
    throw new Error('Please configure your Affinity API key and List ID in the extension settings.');
  }

  const { fullName, linkedinUrl } = profileData;
  const orgName = `Stealth_${fullName}`;

  // Parse name into first and last
  const nameParts = fullName.split(' ');
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ') || firstName;

  try {
    // Step 1: Get current user (for owner assignment)
    const currentUser = await getCurrentUser(settings.affinityApiKey);
    console.log('Current user:', currentUser);

    // Step 2: Create the organization
    const organization = await createOrganization(settings.affinityApiKey, orgName);
    console.log('Created organization:', organization);

    // Step 3: Create the person
    const person = await createPerson(settings.affinityApiKey, firstName, lastName, linkedinUrl);
    console.log('Created/found person:', person);

    // Step 4: Link person to organization (both directions for reliability)
    await linkPersonToOrganization(settings.affinityApiKey, person.id, organization.id);
    console.log('Linked person to organization');

    // Step 5: Add organization to the deal list
    const listEntry = await addToList(settings.affinityApiKey, settings.affinityListId, organization.id);
    console.log('Added to list:', listEntry);

    // Step 6: Set owner on the list entry
    if (currentUser && listEntry) {
      await setListEntryOwner(settings.affinityApiKey, settings.affinityListId, listEntry.id, currentUser.id);
      console.log('Set owner to:', currentUser.first_name, currentUser.last_name);
    }

    return {
      success: true,
      organization: organization,
      person: person,
      listEntry: listEntry,
      owner: currentUser
    };
  } catch (error) {
    console.error('Affinity API Error:', error);
    throw error;
  }
}

async function getCurrentUser(apiKey) {
  try {
    const response = await fetch(`${AFFINITY_API_BASE}/whoami`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return response.json();
    }
  } catch (e) {
    console.log('Failed to get current user:', e);
  }
  return null;
}

async function setListEntryOwner(apiKey, listId, listEntryId, userId) {
  try {
    // First, get the fields for this list to find the Owner field
    const fieldsResponse = await fetch(`${AFFINITY_API_BASE}/lists/${listId}/fields`, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      }
    });

    if (!fieldsResponse.ok) {
      console.log('Failed to get list fields');
      return;
    }

    const fields = await fieldsResponse.json();

    // Find the Owner field (usually named "Owner" and has value_type "person")
    const ownerField = fields.find(f =>
      f.name.toLowerCase() === 'owner' ||
      (f.value_type === 'person' && f.name.toLowerCase().includes('owner'))
    );

    if (!ownerField) {
      console.log('Owner field not found in list. Available fields:', fields.map(f => f.name));
      return;
    }

    console.log('Found owner field:', ownerField);

    // Set the owner field value
    const response = await fetch(`${AFFINITY_API_BASE}/field-values`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(':' + apiKey),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        field_id: ownerField.id,
        entity_id: listEntryId,
        value: userId
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log('Failed to set owner:', errorData);
    } else {
      console.log('Owner set successfully');
    }
  } catch (e) {
    console.log('Failed to set owner:', e);
  }
}

async function createOrganization(apiKey, name) {
  const response = await fetch(`${AFFINITY_API_BASE}/organizations`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + btoa(':' + apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: name
    })
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
