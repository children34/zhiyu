// contact.js – handles the "聯絡我們" modal on index.html
// Minimal script, no dependency on the heavy editor logic.
// It runs after the DOM is ready and wires up the button, close button,
// and form submission (mailto link).

document.addEventListener('DOMContentLoaded', () => {
  const contactToggle = document.getElementById('contact-us-toggle');
  const contactModal = document.getElementById('contact-modal');
  const contactClose = document.getElementById('contact-close');
  const contactForm = document.getElementById('contact-form');

  if (contactToggle && contactModal) {
    contactToggle.addEventListener('click', () => contactModal.classList.remove('hidden'));
  }

  if (contactClose && contactModal) {
    contactClose.addEventListener('click', () => contactModal.classList.add('hidden'));
  }

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(contactForm);
      const payload = {
        name: formData.get('name')?.trim() || '',
        email: formData.get('email')?.trim() || '',
        message: formData.get('message')?.trim() || '',
      };
      try {
        const resp = await fetch('/api/send-contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await resp.json();
        if (result.success) {
          alert('訊息已送出，感謝您的聯絡！');
          contactModal.classList.add('hidden');
          contactForm.reset();
        } else {
          alert(`送出失敗：${result.error || '未知錯誤'}`);
        }
      } catch (err) {
        console.error('送出聯絡表單時發生錯誤', err);
        alert('無法連線至伺服器，請稍後再試');
      }
    });
  }
});
