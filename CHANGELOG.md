## 1.2.0 (2018-03-14)

### Bug fixes

Fix a problem where updating the state of a non-editable view would not set the selection, causing problems when the DOM was updated in a way that disrupted the DOM selection.

Fix an issue where, on IE and Chrome, starting a drag selection in a position that required a cursor wrapper (on a mark boundary) would sometimes fail to work.

Fix crash in key handling when the editor is focused but there is no DOM selection.

Fixes a bug that prevented decorations inside node views with a [`contentDOM` property](https://prosemirror.net/docs/ref/#view.NodeView.contentDOM) from being drawn.

Fixes an issue where, on Firefox, depending on a race condition, the skipping over insignificant DOM nodes done at keypress was canceled again before the keypress took effect.

Fixes an issue where an `:after` pseudo-element on a non-inclusive mark could block the cursor, making it impossible to arrow past it.

### New features

The DOM structure for marks is no longer constrained to a single node. [Mark views](https://prosemirror.net/docs/ref/#view.NodeView) can have a `contentDOM` property, and [mark spec](https://prosemirror.net/docs/ref/#model.MarkSpec) `toDOM` methods can return structures with holes.

[Widget decorations](https://prosemirror.net/docs/ref/#view.Decoration^widget) are now wrapped in the marks of the node after them when their [`side` option](https://prosemirror.net/docs/ref/#view.Decoration^widget^spec.side) is >= 0.

[Widget decorations](https://prosemirror.net/docs/ref/#view.Decoration^widget) may now specify a [`marks` option](https://prosemirror.net/docs/ref/#view.Decoration^widget^spec.marks) to set the precise set of marks they should be wrapped in.

## 1.1.1 (2018-03-01)

### Bug fixes

Fixes typo that broke paste.

## 1.1.0 (2018-02-28)

### Bug fixes

Fixes issue where dragging a draggable node directly below a selected node would move the old selection rather than the target node.

A drop that can't fit the dropped content will no longer dispatch an empty transaction.

### New features

Transactions generated for drop now have a `"uiEvent"` metadata field holding `"drop"`. Paste and cut transactions get that field set to `"paste"` or `"cut"`.

## 1.0.11 (2018-02-16)

### Bug fixes

Fix issue where the cursor was visible when a node was selected on recent Chrome versions.

## 1.0.10 (2018-01-24)

### Bug fixes

Improve preservation of open and closed nodes in slices taken from the clipboard.

## 1.0.9 (2018-01-17)

### Bug fixes

Work around a Chrome cursor motion bug by making sure <br> nodes don't get a contenteditable=false attribute.

## 1.0.8 (2018-01-09)

### Bug fixes

Fix issue where [`Decoration.map`](http://prosemirror.net/docs/ref/#view.DecorationSet.map) would in some situations with nested nodes incorrectly map decoration positions.

## 1.0.7 (2018-01-05)

### Bug fixes

Pasting from an external source no longer opens isolating nodes like table cells.

## 1.0.6 (2017-12-26)

### Bug fixes

[`DecorationSet.remove`](http://prosemirror.net/docs/ref/#view.DecorationSet.remove) now uses a proper deep compare to determine if widgets are the same (it used to compare by identity).

## 1.0.5 (2017-12-05)

### Bug fixes

Fix an issue where deeply nested decorations were mapped incorrectly in corner cases.

## 1.0.4 (2017-11-27)

### Bug fixes

Fix a corner-case crash during drop.

## 1.0.3 (2017-11-23)

### Bug fixes

Pressing backspace between two identical characters will no longer generate a transaction that deletes the second one.

## 1.0.2 (2017-11-20)

### Bug fixes

Fix test for whether a node can be selected when arrowing onto it from the right.

Calling [`posAtCoords`](http://prosemirror.net/docs/ref/#view.EditorView.posAtCoords) while a read from the DOM is pending will no longer return a malformed result.

## 1.0.1 (2017-11-10)

### Bug fixes

Deleting the last character in a list item no longer results in a spurious hard_break node on Safari.

Fixes a crash on IE11 when starting to drag.

## 1.0.0 (2017-10-13)

### Bug fixes

Dragging nodes with a node view that handles its own mouse events should work better now.

List item DOM nodes are no longer assigned `pointer-events: none` in the default style. Ctrl-clicking list markers now properly selects the list item again.

Arrow-down through an empty textblock no longer causes the browser to forget the cursor's horizontal position.

Copy-dragging on OS X is now done by holding option, rather than control, following the convention on that system.

Fixes a crash related to decoration management.

Fixes a problem where using cut on IE11 wouldn't actually remove the selected text.

Copy/paste on Edge 15 and up now uses the clipboard API, fixing a problem that made them fail entirely.

### New features

The [`dragging`](http://prosemirror.net/docs/ref/#view.EditorView.dragging) property of a view, which contains information about editor content being dragged, is now part of the public interface.

## 0.24.0 (2017-09-25)

### New features

The [`clipboardTextParser`](http://prosemirror.net/docs/ref/version/0.24.0.html#view.EditorProps.clipboardTextParser) prop is now passed a context position.

## 0.23.0 (2017-09-13)

### Breaking changes

The `onFocus`, `onBlur`, and `handleContextMenu` props are no longer supported. You can achieve their effect with the [`handleDOMEvents`](http://prosemirror.net/docs/ref/version/0.23.0.html#view.EditorProps.handleDOMEvents) prop.

### Bug fixes

Fixes occasional crash when reading the selection in Firefox.

Putting a table cell on the clipboard now properly wraps it in a table.

The view will no longer scroll into view when receiving a state that isn't derived from its previous state.

### New features

Transactions caused by a paste now have their "paste" meta property set to true.

Adds a new view prop, [`handleScrollToSelection`](http://prosemirror.net/docs/ref/version/0.23.0.html#view.EditorProps.handleScrollToSelection) to override the behavior of scrolling the selection into view.

The new editor prop [`clipboardTextSerializer`](http://prosemirror.net/docs/ref/version/0.23.0.html#view.EditorProps.clipboardTextSerializer) allows you to override the way a piece of document is converted to clipboard text.

Adds the editor prop [`clipboardTextParser`](http://prosemirror.net/docs/ref/version/0.23.0.html#view.EditorProps.clipboardTextParser), which can be used to define your own parsing strategy for clipboard text content.

[`DecorationSet.find`](http://prosemirror.net/docs/ref/version/0.23.0.html#view.DecorationSet.find) now supports passing a predicate to filter decorations by spec.

## 0.22.1 (2017-08-16)

### Bug fixes

Invisible selections that don't cover any content (i.e., a cursor) are now properly hidden.

Initializing the editor view non-editable no longer causes a crash.

## 0.22.0 (2017-06-29)

### Bug fixes

Fix an issue where moving the cursor through a text widget causes the editor to lose the selection in Chrome.

Fixes an issue where down-arrow in front of a widget would sometimes not cause any cursor motion on Chrome.

[Destroying](http://prosemirror.net/docs/ref/version/0.22.0.html#view.EditorView.destroy) a [mounted](http://prosemirror.net/docs/ref/version/0.22.0.html#view.EditorView.constructor) editor view no longer leaks event handlers.

Display updates for regular, non-composition input are now synchronous, which should reduce flickering when, for example, updating decorations in response to typing.

### New features

The editor can now be initialized in a document other than the global document (say, an `iframe`).

Editor views now have a [`domAtPos` method](http://prosemirror.net/docs/ref/version/0.22.0.html#view.EditorView.domAtPos), which gives you the DOM position corresponding to a given document position.

## 0.21.1 (2017-05-09)

### Bug fixes

Copying and pasting table cells on Edge no longer strips the table structure.

## 0.21.0 (2017-05-03)

### Breaking changes

The `associative` option to widget decorations is no longer supported. To make a widget left-associative, set its `side` option to a negative number. `associative` will continue to work with a warning until the next release.

### New features

[Widget decorations](http://prosemirror.net/docs/ref/version/0.21.0.html#view.Decoration^widget) now support a `side` option that controls which side of them the cursor is drawn, where they move when content is inserted at their position, and the order in which they appear relative to other widgets at the same position.

## 0.20.5 (2017-05-02)

### Bug fixes

Fixes an issue where the DOM selection could be shown on the wrong side of hard break or image nodes.

## 0.20.4 (2017-04-24)

### Bug fixes

Fix a bug that prevented the DOM selection from being updated when the new position was near the old one in some circumstances.

Stop interfering with alt-d keypresses on OS X.

Fix issue where reading a DOM change in a previously empty node could crash.

Fixes crash when reading a change that removed a decorated text node from the DOM.

## 0.20.3 (2017-04-12)

### Bug fixes

Shift-pasting and pasting into a code block now does the right thing on IE and Edge.

## 0.20.2 (2017-04-05)

### Bug fixes

Fixes a bug that broke dragging from the editor.

## 0.20.1 (2017-04-04)

### Bug fixes

Typing in code blocks no longer replaces newlines with spaces.

Copy and paste on Internet Explorer, Edge, and mobile Safari should now behave more like it does on other browsers. Handlers are called, and the changes to the document are made by ProseMirror's code, not the browser.

Fixes a problem where triple-clicking the editor would sometimes cause the scroll position to inexplicably jump around on IE11.

## 0.20.0 (2017-04-03)

### Breaking changes

The `inclusiveLeft` and `inclusiveRight` options to inline decorations were renamed to [`inclusiveStart`](http://prosemirror.net/docs/ref/version/0.20.0.html#view.Decoration^inline^spec.inclusiveStart) and [`inclusiveEnd`](http://prosemirror.net/docs/ref/version/0.20.0.html#view.Decoration^inline^spec.inclusiveEnd) so that they also make sense in right-to-left text. The old names work with a warning until the next release.

The default styling for lists and blockquotes was removed from `prosemirror.css`. (They were moved to the [`example-setup`](https://github.com/ProseMirror/prosemirror-example-setup) module.)

### Bug fixes

Fixes reading of selection in Chrome in a shadow DOM.

Registering DOM event handlers that the editor doesn't listen to by default with the `handleDOMEvents` prop should work again.

Backspacing after turning off a mark now works again in Firefox.

### New features

The new props [`handlePaste`](http://prosemirror.net/docs/ref/version/0.20.0.html#view.EditorProps.handlePaste) and [`handleDrop`](http://prosemirror.net/docs/ref/version/0.20.0.html#view.EditorProps.handleDrop) can be used to override drop and paste behavior.

## 0.19.1 (2017-03-18)

### Bug fixes

Fixes a number of issues with characters being duplicated or disappearing when typing on mark boundaries.

## 0.19.0 (2017-03-16)

### Breaking changes

[`endOfTextblock`](http://prosemirror.net/docs/ref/version/0.19.0.html#view.EditorView.endOfTextblock) no longer always returns false for horizontal motion on non-cursor selections, but checks the position of the selection head instead.

### Bug fixes

Typing after adding/removing a mark no longer briefly shows the new text with the wrong marks.

[`posAtCoords`](http://prosemirror.net/docs/ref/version/0.19.0.html#view.EditorView.posAtCoords) is now more reliable on modern browsers by using browser APIs.

Fix a bug where the view would in some circumstances leave superfluous DOM nodes around inside marks.

### New features

You can now override the selection the editor creates for a given DOM selection with the [`createSelectionBetween`](http://prosemirror.net/docs/ref/version/0.19.0.html#view.EditorProps.createSelectionBetween) prop.

## 0.18.0 (2017-02-24)

### Breaking changes

`Decoration` objects now store their definition object under [`spec`](http://prosemirror.net/docs/ref/version/0.18.0.html#Decoration.spec), not `options`. The old property name still works, with a warning, until the next release.

### Bug fixes

Fix bug where calling [`focus`](http://prosemirror.net/docs/ref/version/0.18.0.html#view.EditorView.focus) when there was a text selection would sometimes result in `state.selection` receiving an incorrect value.

[`EditorView.props`](http://prosemirror.net/docs/ref/version/0.18.0.html#view.EditorView.props) now has its `state` property updated when you call `updateState`.

Putting decorations on or inside a node view with an `update` method now works.

### New features

[Plugin view](http://prosemirror.net/docs/ref/version/0.18.0.html#state.PluginSpec.view) update methods are now passed the view's previous state as second argument.

The `place` agument to the [`EditorView` constructor](http://prosemirror.net/docs/ref/version/0.18.0.html#view.EditorView) can now be an object with a `mount` property to directly provide the node that should be made editable.

The new [`EditorView.setProps` method](http://prosemirror.net/docs/ref/version/0.18.0.html#view.EditorView.setProps) makes it easier to update individual props.

## 0.17.7 (2017-02-08)

### Bug fixes

Fixes crash in the code that maintains the scroll position when the document is empty or hidden.

## 0.17.6 (2017-02-08)

### Bug fixes

Transactions that shouldn't [scroll the selection into view](http://prosemirror.net/docs/ref/version/0.17.0.html#state.transaction.scrollIntoView) now no longer do so.

## 0.17.4 (2017-02-02)

### Bug fixes

Fixes bug where widget decorations would sometimes get parsed as content when editing near them.

The editor now prevents the behavior of Ctrl-d and Ctrl-h on textblock boundaries on OS X, as intended.

Make sure long words don't cause a horizontal scrollbar in Firefox

Various behavior fixes for IE11.

## 0.17.3 (2017-01-19)

### Bug fixes

DOM changes deleting a node's inner wrapping DOM element (for example the `<code>` tag in a schema-basic code block) no longer break the editor.

## 0.17.2 (2017-01-16)

### Bug fixes

Call custom click handlers before applying select-node behavior for a ctrl/cmd-click.

Fix failure to apply DOM changes that start at document position 0.

## 0.17.1 (2017-01-07)

### Bug fixes

Fix issue where a document update that left the selection in the same place sometimes led to an incorrect DOM selection.

Make sure [`EditorView.focus`](http://prosemirror.net/docs/ref/version/0.17.0.html#view.EditorView.focus) doesn't cause the browser to scroll the top of the editor into view.

## 0.17.0 (2017-01-05)

### Breaking changes

The `handleDOMEvent` prop has been dropped in favor of the [`handleDOMEvents`](http://prosemirror.net/docs/ref/version/0.17.0.html#view.EditorProps.handleDOMEvents) (plural) prop.

The `onChange` prop has been replaced by a [`dispatchTransaction`](http://prosemirror.net/docs/ref/version/0.17.0.html#view.EditorProps.dispatchTransaction) prop (which takes a transaction instead of an action).

### New features

Added support for a [`handleDOMEvents` prop](http://prosemirror.net/docs/ref/version/0.17.0.html#view.EditorProps.handleDOMEvents), which allows you to provide handler functions per DOM event, and works even for events that the editor doesn't normally add a handler for.

Add view method [`dispatch`](http://prosemirror.net/docs/ref/version/0.17.0.html#view.EditorView.dispatch), which provides a convenient way to dispatch transactions.

The [`dispatchTransaction`](http://prosemirror.net/docs/ref/version/0.17.0.html#view.EditorProps.dispatchTransaction) (used to be `onAction`) prop is now optional, and will default to simply applying the transaction to the current view state.

[Widget decorations](http://prosemirror.net/docs/ref/version/0.17.0.html#view.Decoration.widget) now accept an option `associative` which can be used to configure on which side of content inserted at their position they end up.

Typing immediately after deleting text now preserves the marks of the deleted text.

Transactions that update the selection because of mouse or touch input now get a metadata property `pointer` with the value `true`.

## 0.16.0 (2016-12-23)

### Bug fixes

Solve problem where setting a node selection would trigger a DOM read, leading to the selection being reset.

## 0.16.0 (2016-12-23)

### Breaking changes

The `spellcheck`, `label`, and `class` props are now replaced by an [`attributes` prop](http://prosemirror.net/docs/ref/version/0.16.0.html#view.EditorProps.attributes).

### Bug fixes

Ignoring/aborting an action should no longer lead to the DOM being stuck in an outdated state.

Typing at the end of a textblock which ends in a non-text node now actually works.

DOM nodes for leaf document nodes are now set as non-editable to prevent various issues such as stray cursors inside of them and Firefox adding image resize controls.

Inserting a node no longer causes nodes of the same type after it to be neednessly redrawn.

### New features

Add a new editor prop [`editable`](http://prosemirror.net/docs/ref/version/0.16.0.html#view.EditorProps.editable) which controls whether the editor's `contentEditable` behavior is enabled.

Plugins and props can now set any DOM attribute on the outer editor node using the [`attributes` prop](http://prosemirror.net/docs/ref/version/0.16.0.html#view.EditorProps.attributes).

Node view constructors and update methods now have access to the node's wrapping decorations, which can be used to pass information to a node view without encoding it in the document.

Attributes added or removed by node and inline [decorations](http://prosemirror.net/docs/ref/version/0.16.0.html#view.Decoration) no longer cause the nodes inside of them to be fully redrawn, making node views more stable and allowing CSS transitions to be used.

## 0.15.2 (2016-12-10)

### Bug fixes

The native selection is now appropriately hidden when there is a node selection.

## 0.15.1 (2016-12-10)

### Bug fixes

Fix DOM parsing for decorated text nodes.

## 0.15.0 (2016-12-10)

### Breaking changes

The editor view no longer wraps its editable DOM element in a wrapper element. The `ProseMirror` CSS class now applies directly to the editable element. The `ProseMirror-content` CSS class is still present for ease of upgrading but will be dropped in the next release.

The editor view no longer draws a drop cursor when dragging content over the editor. The new [`prosemirror-dropcursor`](https://github.com/prosemirror/prosemirror-dropcursor) module implements this as a plugin.

### Bug fixes

Simple typing and backspacing now gets handled by the browser without ProseMirror redrawing the touched nodes, making spell-checking and various platform-specific input tricks (long-press on OS X, double space on iOS) work in the editor.

Improve tracking of DOM nodes that have been touched by user changes, so that [`updateState`](http://prosemirror.net/docs/ref/version/0.15.0.html#view.EditorView.updateState) can reliably fix them.

Changes to the document that happen while dragging editor content no longer break moving of the content.

Adding or removing a mark directly in the DOM (for example with the bold/italic buttons in iOS' context menu) now produces mark steps, rather than replace steps.

Pressing backspace at the start of a paragraph on Android now allows key handlers for backspace to fire.

Toggling a mark when there is no selection now works better on mobile platforms.

### New features

Introduces an [`endOfTextblock`](http://prosemirror.net/docs/ref/version/0.15.0.html#view.EditorView.endOfTextblock) method on views, which can be used to find out in a bidi- and layout-aware way whether the selection is on the edge of a textblock.

## 0.14.4 (2016-12-02)

### Bug fixes

Fix issue where node decorations would stick around in the DOM after the decoration was removed.

Setting or removing a node selection in an unfocused editor now properly updates the DOM to show that selection.

## 0.14.2 (2016-11-30)

### Bug fixes

FIX: Avoid unneeded selection resets which sometimes confused browsers.

## 0.14.2 (2016-11-29)

### Bug fixes

Fix a bug where inverted selections weren't created in the DOM correctly.

## 0.14.1 (2016-11-29)

### Bug fixes

Restores previously broken kludge that allows the cursor to appear after non-text content at the end of a line.

## 0.14.0 (2016-11-28)

### Breaking changes

Wrapping decorations are now created using the [`nodeName`](http://prosemirror.net/docs/ref/version/0.14.0.html#view.DecorationAttrs.nodeName) property. The `wrapper` property is no longer supported.

The `onUnmountDOM` prop is no longer supported (use a node view with a [`destroy`](http://prosemirror.net/docs/ref/version/0.14.0.html#view.NodeView.destroy) method instead).

The `domSerializer` prop is no longer supported. Use [node views](http://prosemirror.net/docs/ref/version/0.14.0.html#view.EditorProps.nodeViews) to configure editor-specific node representations.

### New features

Widget decorations can now be given a [`key`](http://prosemirror.net/docs/ref/version/0.14.0.html#view.Decoration.widget^options.key) property to prevent unneccesary redraws.

The `EditorView` class now has a [`destroy`](http://prosemirror.net/docs/ref/version/0.14.0.html#view.EditorView.destroy) method for cleaning up.

The [`handleClickOn`](http://prosemirror.net/docs/ref/version/0.14.0.html#view.EditorProps.handleClickOn) prop and friends now receive a `direct` boolean argument that indicates whether the node was clicked directly.

[Widget decorations](http://prosemirror.net/docs/ref/version/0.14.0.html#view.Decoration^widget) now support a `stopEvent` option that can be used to control which DOM events that pass through them should be ignored by the editor view.

You can now [specify](http://prosemirror.net/docs/ref/version/0.14.0.html#view.EditorProps.nodeViews) custom [node views](http://prosemirror.net/docs/ref/version/0.14.0.html#view.NodeView) for an editor view, which give you control over the way node of a given type are represented in the DOM. See the related [RFC](https://discuss.prosemirror.net/t/rfc-node-views-to-manage-the-representation-of-nodes/463).

## 0.13.2 (2016-11-15)

### Bug fixes

Fixes an issue where widget decorations in the middle of text nodes would sometimes disappear.

## 0.13.1 (2016-11-15)

### Bug fixes

Fixes event handler crash (and subsequent bad default behavior) when pasting some types of external HTML into an editor.

## 0.13.0 (2016-11-11)

### Breaking changes

Selecting nodes on OS X is now done with cmd-leftclick rather than ctrl-leftclick.

### Bug fixes

Pasting text into a code block will now insert the raw text.

Widget decorations at the start or end of a textblock no longer block horizontal cursor motion through them.

Widget nodes at the end of textblocks are now reliably drawn during display updates.

### New features

[`DecorationSet.map`](http://prosemirror.net/docs/ref/version/0.13.0.html#view.DecorationSet.map) now takes an options object which allows you to specify an `onRemove` callback to be notified when remapping drops decorations.

The [`transformPastedHTML`](http://prosemirror.net/docs/ref/version/0.13.0.html#view.EditorProps.transformPastedHTML) and [`transformPastedText`](http://prosemirror.net/docs/ref/version/0.13.0.html#view.EditorProps.transformPastedText) props were (re-)added, and can be used to clean up pasted content.

## 0.12.2 (2016-11-02)

### Bug fixes

Inline decorations that span across an empty textblock no longer crash the display drawing code.

## 0.12.1 (2016-11-01)

### Bug fixes

Use a separate document to parse pasted HTML to better protect
against cross-site scripting attacks.

Specifying multiple classes in a decoration now actually works.

Ignore empty inline decorations when building a decoration set.

## 0.12.0 (2016-10-21)

### Breaking changes

The return value of
[`EditorView.posAtCoords`](http://prosemirror.net/docs/ref/version/0.12.0.html#view.EditorView.posAtCoords) changed to
contain an `inside` property pointing at the innermost node that the
coordinates are inside of. (Note that the docs for this method were
wrong in the previous release.)

### Bug fixes

Reduce reliance on shift-state tracking to minimize damage when
it gets out of sync.

Fix bug that'd produce bogus document positions for DOM positions
inside non-document nodes.

Don't treat fast ctrl-clicks as double or triple clicks.

### New features

Implement [decorations](http://prosemirror.net/docs/ref/version/0.12.0.html#view.Decoration), a way to
influence the way the document is drawn. Add the [`decorations`
prop](http://prosemirror.net/docs/ref/version/0.12.0.html#view.EditorProps.decorations) to specify them.

## 0.11.2 (2016-10-04)

### Bug fixes

Pass actual event object to [`handleDOMEvent`](http://prosemirror.net/docs/ref/version/0.11.0.html#view.EditorProps.handleDOMEvent), rather than just its name.

Fix display corruption caused by using the wrong state as previous version during IME.

## 0.11.0 (2016-09-21)

### Breaking changes

Moved into a separate module from the old `edit` submodule. Completely
new approach to managing the editor's DOM representation and input.

Event handlers and options are now replaced by
[props](http://prosemirror.net/docs/ref/version/0.11.0.html#view.EditorProps). The view's state is now 'shallow',
represented entirely by a set of props, one of which holds an editor
state value from the [state](http://prosemirror.net/docs/ref/version/0.11.0.html#state) module.

When the user interacts with the editor, it will pass an
[action](http://prosemirror.net/docs/ref/version/0.11.0.html#state.Action) to its
[`onAction`](http://prosemirror.net/docs/ref/version/0.11.0.html#view.EditorProps.onAction) prop, which is responsible
for triggering an view update.

The `markRange` system was dropped, to be replaced in the next release
by a 'decoration' system.

There is no keymap support in the view module anymore. Use a
[keymap](http://prosemirror.net/docs/ref/version/0.11.0.html#keymap) plugin for that.

The undo [history](http://prosemirror.net/docs/ref/version/0.11.0.html#history) is now a separate plugin.

CSS needed by the editor is no longer injected implicitly into the
page. Instead, you should arrange for the `style/prosemirror.css` file
to be loaded into your page.

### New features

The DOM [parser](http://prosemirror.net/docs/ref/version/0.11.0.html#model.DOMParser) and
[serializer](http://prosemirror.net/docs/ref/version/0.11.0.html#model.DOMSerializer) used to interact with the visible
DOM and the clipboard can now be customized through
[props](http://prosemirror.net/docs/ref/version/0.11.0.html#view.EditorProps).

You can now provide a catch-all DOM
[event handler](http://prosemirror.net/docs/ref/version/0.11.0.html#view.EditorProps.handleDOMEvent) to get a first
chance at handling DOM events.

The [`onUnmountDOM`](http://prosemirror.net/docs/ref/version/0.11.0.html#view.EditorProps.onUnmountDOM) can be used to
be notified when a piece of the document DOM is thrown away (in case
cleanup is needed).
