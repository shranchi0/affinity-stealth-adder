document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const listIdInput = document.getElementById('listId');
  const tenantSubdomainInput = document.getElementById('tenantSubdomain');
  const userEmailInput = document.getElementById('userEmail');
  const saveButton = document.getElementById('save');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get(['affinityApiKey', 'affinityListId', 'affinityTenantSubdomain', 'affinityUserEmail'], (result) => {
    if (result.affinityApiKey) {
      apiKeyInput.value = result.affinityApiKey;
    }
    if (result.affinityListId) {
      listIdInput.value = result.affinityListId;
    }
    if (result.affinityTenantSubdomain) {
      tenantSubdomainInput.value = result.affinityTenantSubdomain;
    }
    if (result.affinityUserEmail) {
      userEmailInput.value = result.affinityUserEmail;
    }
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const listId = listIdInput.value.trim();
    const tenantSubdomain = tenantSubdomainInput.value.trim();
    const userEmail = userEmailInput.value.trim();

    if (!apiKey || !listId || !tenantSubdomain) {
      showStatus('Please fill in API key, List ID, and subdomain', 'error');
      return;
    }

    chrome.storage.sync.set({
      affinityApiKey: apiKey,
      affinityListId: listId,
      affinityTenantSubdomain: tenantSubdomain,
      affinityUserEmail: userEmail
    }, () => {
      showStatus('Settings saved successfully!', 'success');
    });
  });

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + type;
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 3000);
  }
});
