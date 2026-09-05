// contact.js - Handles the Contact Us modal toggle

// Ensure the DOM is fully loaded before attaching event listeners
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('contact-us-toggle');
  const modal = document.getElementById('contact-modal');
  const closeBtn = document.getElementById('contact-close');

  if (toggleBtn && modal) {
    toggleBtn.addEventListener('click', () => {
      modal.classList.remove('hidden');
    });
  }

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  // Optional: close the modal when clicking outside the dialog box
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }
});
