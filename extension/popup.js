// Get platform specific controls object.
let platform = chrome ? chrome : browser;

document.addEventListener('DOMContentLoaded', function() {
    platform.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        // Get domain.
        let domain = tabs[0].url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n]+)/im)[1];

        // Get the range input and volumerange.
        let rangeInput = document.querySelector('.volume-range');
        let valueDiv = document.querySelector('.value');

        function updateVolume(value) {
            valueDiv.textContent = value + '%';
            platform.runtime.sendMessage({ id: tabs[0].id, volume: value });
        }

        rangeInput.addEventListener('input', function() {
            let value = parseInt(this.value, 10);
            updateVolume(value);
        });

        // Button click event.
        document.getElementById('resetBtn').addEventListener('click', function() {
            // Set volume to default.
            updateVolume(100);

            // Exit the window.
            window.close();
        });

        // Get and apply volume level from storage.
        platform.storage.local.get(domain, function(items) {
            let volume = items[domain];
            if (!volume) {
                volume = 100;
                let items = {};
                items[domain] = 100;
                platform.storage.local.set(items);
            }

            // Apply volume to interface.
            rangeInput.value = volume;
            valueDiv.textContent = volume + '%';
        });
    });
});