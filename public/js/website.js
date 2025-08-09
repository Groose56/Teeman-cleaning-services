document.getElementById('booking-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const data = Object.fromEntries(formData.entries());
  
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
  
      const result = await response.json();
      if (response.ok) {
        alert('Booking submitted successfully!');
      } else {
        alert(result.message || 'Booking failed.');
      }
    } catch (error) {
      console.error('Booking error:', error);
      alert('An error occurred while submitting your booking.');
    }
  });
  