// Affinity Stealth Adder - Content Script
(function() {
  'use strict';

  // Prevent duplicate injection
  if (window.affinityStealthAdderLoaded) return;
  window.affinityStealthAdderLoaded = true;

  // Create floating button
  function createFloatingButton() {
    const button = document.createElement('button');
    button.id = 'affinity-stealth-btn';
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      <span>Add to Affinity</span>
    `;
    button.title = 'Add as Stealth to Affinity';
    document.body.appendChild(button);

    button.addEventListener('click', handleAddToAffinity);
    return button;
  }

  // Extract profile data from LinkedIn page
  function extractProfileData() {
    // Get the profile name - LinkedIn uses h1 for the main name
    const nameElement = document.querySelector('h1.text-heading-xlarge') ||
                        document.querySelector('h1[class*="text-heading"]') ||
                        document.querySelector('.pv-top-card h1') ||
                        document.querySelector('h1');

    const fullName = nameElement ? nameElement.textContent.trim() : null;
    const linkedinUrl = window.location.href.split('?')[0]; // Remove query params

    return {
      fullName,
      linkedinUrl
    };
  }

  // Handle button click
  async function handleAddToAffinity() {
    const button = document.getElementById('affinity-stealth-btn');
    const originalContent = button.innerHTML;

    try {
      // Show loading state
      button.classList.add('loading');
      button.innerHTML = `
        <svg class="spinner" width="20" height="20" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="60" stroke-dashoffset="20"/>
        </svg>
        <span>Adding...</span>
      `;

      // Extract profile data
      const profileData = extractProfileData();

      if (!profileData.fullName) {
        throw new Error('Could not extract profile name. Make sure you are on a LinkedIn profile page.');
      }

      // Send to background script
      const response = await chrome.runtime.sendMessage({
        action: 'addToAffinity',
        data: profileData
      });

      if (response.success) {
        button.classList.remove('loading');
        button.classList.add('success');
        button.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>Added!</span>
        `;

        // Reset after 3 seconds
        setTimeout(() => {
          button.classList.remove('success');
          button.innerHTML = originalContent;
        }, 3000);
      } else {
        throw new Error(response.error || 'Failed to add to Affinity');
      }
    } catch (error) {
      button.classList.remove('loading');
      button.classList.add('error');
      button.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>Error</span>
      `;

      console.error('Affinity Stealth Adder Error:', error);
      alert('Error: ' + error.message);

      // Reset after 3 seconds
      setTimeout(() => {
        button.classList.remove('error');
        button.innerHTML = originalContent;
      }, 3000);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createFloatingButton);
  } else {
    createFloatingButton();
  }

  // Re-check on navigation (LinkedIn is a SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      // Only show button on profile pages
      if (url.includes('/in/')) {
        if (!document.getElementById('affinity-stealth-btn')) {
          createFloatingButton();
        }
      } else {
        const existingBtn = document.getElementById('affinity-stealth-btn');
        if (existingBtn) existingBtn.remove();
      }
    }
  }).observe(document, { subtree: true, childList: true });
})();
