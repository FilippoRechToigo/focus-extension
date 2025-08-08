document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const blockedUrl = urlParams.get('url');
    if (blockedUrl) {
        document.getElementById('blockedUrl').textContent = decodeURIComponent(blockedUrl);
    }
});
