// content.js

// This function notifies the user if the current page is not loaded over HTTPS by displaying a warning message.
function notifyIfHttpsUnavailable() {
  // Check if the page protocol is not HTTPS
  if (window.location.protocol !== 'https:') {
    // Create a notification div and set its properties for visibility
    const notification = document.createElement('div');
    notification.innerText = 'Warning: This page is not loaded over HTTPS. Your connection may not be secure.';
    notification.style.background = 'red';
    notification.style.color = 'white';
    notification.style.padding = '10px';
    notification.style.position = 'fixed';
    notification.style.bottom = '0';
    notification.style.width = '100%';
    notification.style.textAlign = 'center';
    notification.style.zIndex = '1000'; // Ensure the notification is visible above other elements
    document.body.appendChild(notification); // Add the notification to the page
  }
}

// Call the function to notify users if HTTPS is not available
notifyIfHttpsUnavailable();
