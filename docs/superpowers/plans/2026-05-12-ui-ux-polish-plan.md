# UI/UX Polish: Minimalist Flat Redesign Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform CodeRooms into a Minimalist Flat UI by removing blurs/transparency, unifying spacing, and snappier animations.

**Architecture:** Solid theme-aware CSS variables, simplified sidebar hierarchy, and removal of non-standard icons.

**Tech Stack:** TypeScript, VS Code Webview API, CSS.

---

### Task 1: Architecture Refresh (CSS Variables)

**Files:**
- Modify: `src/ui/ChatView.ts` (CSS section)

- [ ] **Step 1: Define Flat Variables**
Replace the frosted glass variables with solid ones.
```typescript
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --border: var(--vscode-panel-border);
        --text-main: var(--vscode-editor-foreground);
        --text-dim: var(--vscode-descriptionForeground);
        
        --bubble-other: var(--vscode-editorWidget-background);
        --bubble-other-border: var(--vscode-editorWidget-border);
        
        --bubble-self: var(--vscode-button-background);
        --bubble-self-text: var(--vscode-button-foreground);
        
        --sys-bg: var(--vscode-input-background);
        --link-color: var(--vscode-textLink-foreground);
        --accent: var(--vscode-focusBorder);
```

- [ ] **Step 2: Remove Backdrop Filters**
Search and remove all `backdrop-filter` and `-webkit-backdrop-filter` properties in the CSS template.

- [ ] **Step 3: Commit**
```bash
git add src/ui/ChatView.ts
git commit -m "style(ui): flatten chat css variables and remove blurs"
```

---

### Task 2: Chat View Polish (Grid & Spacing)

**Files:**
- Modify: `src/ui/ChatView.ts` (CSS and HTML)

- [ ] **Step 1: Standardize Padding to 12px**
Update `.chat-header`, `.messages`, `.composer-container`, and `.bubble` to use a consistent 12px padding.

- [ ] **Step 2: Snappy Animations**
Update `@keyframes slideUp` and related transitions to 100ms and use `opacity` only (fade-in) instead of `translateY`.
```css
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .chat-row {
        animation: fadeIn 0.1s ease-out;
      }
```

- [ ] **Step 3: Flatten Bubbles**
Remove `box-shadow` and `border-radius` variations (use a standard `4px` or `0px` for a truly flat look).
```css
      .bubble {
        border-radius: 4px;
        box-shadow: none;
        border: 1px solid var(--border);
      }
```

- [ ] **Step 4: Commit**
```bash
git add src/ui/ChatView.ts
git commit -m "style(ui): standardize chat grid and animations"
```

---

### Task 3: Sidebar Hierarchy & Icons

**Files:**
- Modify: `src/ui/ParticipantsView.ts`
- Modify: `src/ui/viewState.ts`

- [ ] **Step 1: Simplify Header Labels**
Update `viewState.ts` to use shorter, cleaner labels for headers.
```typescript
// Example change in buildReviewHeaderViewModel
return {
  label: 'Review',
  description: `${pending} pending`, // removed "suggestions" to be minimalist
  // ...
};
```

- [ ] **Step 2: Remove Emoji Icons**
Replace emoji strings (like '💭' in empty state or custom emoji icons) with standard VS Code Codicons.
Update `src/ui/ChatView.ts` HTML for empty state:
```html
<div class="empty-icon"><svg class="codicon codicon-comment-discussion"></svg></div>
```

- [ ] **Step 3: Merge Session Actions**
In `ParticipantsView.ts`, if `roomId` is undefined, show only a "Get Started" group with Start/Join actions.

- [ ] **Step 4: Commit**
```bash
git add src/ui/ParticipantsView.ts src/ui/viewState.ts
git commit -m "refactor(ui): simplify sidebar hierarchy and unify icons"
```

---

### Task 4: Review Queue Consolidation

**Files:**
- Modify: `src/ui/ParticipantsView.ts` (SuggestionItem class)

- [ ] **Step 1: Compact Suggestion Items**
Remove the multi-line preview in the tree view. Move it entirely to the `tooltip`.
```typescript
// In SuggestionItem constructor
this.description = `by ${suggestion.authorName} · ${createdTime}`;
// Remove preview.text from this.description
```

- [ ] **Step 2: Verify Tooltip Content**
Ensure the `MarkdownString` in the tooltip still contains the patch preview so the info isn't lost.

- [ ] **Step 3: Commit**
```bash
git add src/ui/ParticipantsView.ts
git commit -m "style(ui): consolidate review queue items"
```

---

### Task 5: Final Validation

- [ ] **Step 1: Check Theme Switching**
Switch between Light, Dark, and High Contrast themes in VS Code and verify the UI remains readable and flat.

- [ ] **Step 2: Verify Mobile/Narrow Width**
Resize the sidebar to its minimum width and ensure chat input and participants list remain usable.

- [ ] **Step 3: Final Commit**
```bash
git commit --allow-empty -m "chore(ui): final ui/ux polish verification"
```
