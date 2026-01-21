document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const listIdInput = document.getElementById('listId');
  const saveButton = document.getElementById('save');
  const statusDiv = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get(['affinityApiKey', 'affinityListId'], (result) => {
    if (result.affinityApiKey) {
      apiKeyInput.value = result.affinityApiKey;
    }
    if (result.affinityListId) {
      listIdInput.value = result.affinityListId;
    }
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const listId = listIdInput.value.trim();

    if (!apiKey || !listId) {
      showStatus('Please fill in both fields', 'error');
      return;
    }

    chrome.storage.sync.set({
      affinityApiKey: apiKey,
      affinityListId: listId
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
