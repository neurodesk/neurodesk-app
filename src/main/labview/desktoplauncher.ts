/** Add an app-owned launcher card without relying on private Jupyter plugin internals.
 * MutationObserver reattaches it when Jupyter creates/renders another launcher.
 * This bridge exposes only the fixed desktop action, not backend credentials/RPC.
 */
export function installDesktopLauncher(document: Document, open: () => void) {
  const update = () => {
    document.querySelectorAll('.jp-Launcher-body').forEach(body => {
      if (body.querySelector('[data-neurodesk-native-desktop]')) {
        return;
      }
      const section = document.createElement('section');
      section.dataset.neurodeskNativeDesktop = 'true';
      section.className = 'jp-Launcher-section';
      const heading = document.createElement('h2');
      heading.textContent = 'Native desktop';
      heading.className = 'jp-Launcher-sectionTitle';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'jp-LauncherCard';
      button.style.width = '102px';
      button.style.height = '102px';
      button.style.display = 'flex';
      button.style.flexDirection = 'column';
      button.style.justifyContent = 'center';
      button.style.alignItems = 'center';
      button.title = 'Start the Linux desktop and open its native window';
      button.setAttribute('aria-label', 'Open native desktop');
      const icon = document.createElement('span');
      icon.className = 'jp-LauncherCard-icon';
      icon.textContent = '▣';
      icon.style.fontSize = '38px';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'jp-LauncherCard-label';
      label.textContent = 'Desktop';
      button.append(icon, label);
      button.addEventListener('click', open);
      section.append(heading, button);
      body.append(section);
    });
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true });
  update();
  window.addEventListener('unload', () => observer.disconnect(), {
    once: true
  });
}
