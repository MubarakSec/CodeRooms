# Design Spec: Minimalist Flat UI/UX Polish

**Date:** 2026-05-12
**Topic:** UI/UX Polish & Aesthetics
**Status:** Approved

## 1. Objective
Transform the CodeRooms UI from its current transparency-heavy "frosted" look to a **Minimalist Flat** aesthetic. The goal is to improve clarity, responsiveness, and visual consistency with the core VS Code environment while maintaining a custom, premium feel.

## 2. Visual Architecture
- **Colors & Transparency:**
  - Remove all `backdrop-filter: blur()`.
  - Replace `color-mix` based transparent backgrounds with solid hex values derived from VS Code theme variables (`--vscode-sideBar-background`, `--vscode-editor-background`).
  - Use high-contrast text colors for better readability.
- **Borders & Grid:**
  - Implement a strict `1px solid var(--vscode-panel-border)` for all container boundaries.
  - Standardize internal padding/margins to a 12px grid (8px for micro-elements).
- **Motion:**
  - Replace 200ms `slide-up` animations with snappier 100ms `fade-in` transitions.
  - Ensure all hover states trigger instantly with subtle color shifts rather than transforms.

## 3. Component Refinements

### 3.1 Chat Webview
- **Header:** Flatten the header. Remove the blur. Use a solid background.
- **Messages:**
  - Simplify the "bubble" design. Remove shadows. Use thin borders.
  - Consistent spacing between message groups.
- **Composer:** Ensure the input field feels like a native VS Code input box.

### 3.2 Participants & Session Sidebar (Tree View)
- **Hierarchy:**
  - Merge redundant "Session" and "Work" blocks when possible.
  - If disconnected, show a single "Get Started" block with direct actions.
- **Review Queue:**
  - Compact the view. Remove multiline previews from the tree.
  - Move detailed patch info to tooltips to keep the list clean.
- **Iconography:**
  - Audit all icons. Standardize on the "Minimalist" set of Codicons.
  - Remove emoji-based icons in favor of standard VS Code symbols.

## 4. UX & Interactions
- **Fast Actions:** Move common actions (Copy Room ID, Join Voice) to the view title menu (top right of sidebar) or as primary buttons.
- **Feedback:** Improve the "empty state" visuals to be clean and informative without visual clutter.

## 5. Testing & Validation
- **Theme Switching:** Verify the UI looks perfect in "Solarized Light", "Dark+", and "High Contrast" modes.
- **Responsive Layout:** Ensure the chat and sidebar remain usable at minimum widths (200px).
- **Performance:** Confirm that removing `backdrop-filter` improves rendering performance on lower-end machines.
