import {Selection, NodeSelection, TextSelection} from "prosemirror-state"
import {dropPoint} from "prosemirror-transform"

import browser from "./browser"
import {captureKeyDown} from "./capturekeys"
import {DOMChange} from "./domchange"
import {parseFromClipboard, serializeForClipboard} from "./clipboard"
import {DOMObserver} from "./domobserver"
import {selectionBetween, needsCursorWrapper} from "./selection"

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
const handlers = {}, editHandlers = {}

export function initInput(view) {
  view.shiftKey = false
  view.mouseDown = null
  view.inDOMChange = null
  view.lastKeyCode = null
  view.lastKeyCodeTime = 0
  view.lastClick = {time: 0, x: 0, y: 0, type: ""}
  view.domObserver = new DOMObserver(view)
  view.domObserver.start()

  view.eventHandlers = Object.create(null)
  for (let event in handlers) {
    let handler = handlers[event]
    view.dom.addEventListener(event, view.eventHandlers[event] = event => {
      if (eventBelongsToView(view, event) && !runCustomHandler(view, event) &&
          (view.editable || !(event.type in editHandlers)))
        handler(view, event)
    })
  }
  ensureListeners(view)
}

export function destroyInput(view) {
  view.domObserver.stop()
  if (view.inDOMChange) view.inDOMChange.destroy()
  for (let type in view.eventHandlers)
    view.dom.removeEventListener(type, view.eventHandlers[type])
}

export function ensureListeners(view) {
  view.someProp("handleDOMEvents", currentHandlers => {
    for (let type in currentHandlers) if (!view.eventHandlers[type])
      view.dom.addEventListener(type, view.eventHandlers[type] = event => runCustomHandler(view, event))
  })
}

function runCustomHandler(view, event) {
  return view.someProp("handleDOMEvents", handlers => {
    let handler = handlers[event.type]
    return handler ? handler(view, event) || event.defaultPrevented : false
  })
}

function eventBelongsToView(view, event) {
  if (!event.bubbles) return true
  if (event.defaultPrevented) return false
  for (let node = event.target; node != view.dom; node = node.parentNode)
    if (!node || node.nodeType == 11 ||
        (node.pmViewDesc && node.pmViewDesc.stopEvent(event)))
      return false
  return true
}

export function dispatchEvent(view, event) {
  if (!runCustomHandler(view, event) && handlers[event.type] &&
      (view.editable || !(event.type in editHandlers)))
    handlers[event.type](view, event)
}

editHandlers.keydown = (view, event) => {
  view.shiftKey = event.keyCode == 16 || event.shiftKey
  if (view.inDOMChange) {
    if (view.inDOMChange.composing) return
    if (view.inDOMChange.ignoreKeyDownOnCompositionEnd(event)) return
    view.inDOMChange.finish()
  }
  view.lastKeyCode = event.keyCode
  view.lastKeyCodeTime = Date.now()
  if (view.someProp("handleKeyDown", f => f(view, event)) || captureKeyDown(view, event))
    event.preventDefault()
  else
    view.selectionReader.poll("key")
}

editHandlers.keyup = (view, e) => {
  if (e.keyCode == 16) view.shiftKey = false
}

editHandlers.keypress = (view, event) => {
  if (view.inDOMChange || !event.charCode ||
      event.ctrlKey && !event.altKey || browser.mac && event.metaKey) return

  if (view.someProp("handleKeyPress", f => f(view, event))) {
    event.preventDefault()
    return
  }

  let sel = view.state.selection
  if (!(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to)) {
    let text = String.fromCharCode(event.charCode)
    if (!view.someProp("handleTextInput", f => f(view, sel.$from.pos, sel.$to.pos, text)))
      view.dispatch(view.state.tr.insertText(text).scrollIntoView())
    event.preventDefault()
  }
}

function eventCoords(event) { return {left: event.clientX, top: event.clientY} }

function isNear(event, click) {
  let dx = click.x - event.clientX, dy = click.y - event.clientY
  return dx * dx + dy * dy < 100
}

function runHandlerOnContext(view, propName, pos, inside, event) {
  if (inside == -1) return false
  let $pos = view.state.doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    if (view.someProp(propName, f => i > $pos.depth ? f(view, pos, $pos.nodeAfter, $pos.before(i), event, true)
                                                    : f(view, pos, $pos.node(i), $pos.before(i), event, false)))
      return true
  }
  return false
}

function updateSelection(view, selection, origin) {
  if (!view.focused) view.focus()
  let tr = view.state.tr.setSelection(selection)
  if (origin == "pointer") tr.setMeta("pointer", true)
  view.dispatch(tr)
}

function selectClickedLeaf(view, inside) {
  if (inside == -1) return false
  let $pos = view.state.doc.resolve(inside), node = $pos.nodeAfter
  if (node && node.isAtom && NodeSelection.isSelectable(node)) {
    updateSelection(view, new NodeSelection($pos), "pointer")
    return true
  }
  return false
}

function selectClickedNode(view, inside) {
  if (inside == -1) return false
  let sel = view.state.selection, selectedNode, selectAt
  if (sel instanceof NodeSelection) selectedNode = sel.node

  let $pos = view.state.doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (NodeSelection.isSelectable(node)) {
      if (selectedNode && sel.$from.depth > 0 &&
          i >= sel.$from.depth && $pos.before(sel.$from.depth + 1) == sel.$from.pos)
        selectAt = $pos.before(sel.$from.depth)
      else
        selectAt = $pos.before(i)
      break
    }
  }

  if (selectAt != null) {
    updateSelection(view, NodeSelection.create(view.state.doc, selectAt), "pointer")
    return true
  } else {
    return false
  }
}

function handleSingleClick(view, pos, inside, event, selectNode) {
  return runHandlerOnContext(view, "handleClickOn", pos, inside, event) ||
    view.someProp("handleClick", f => f(view, pos, event)) ||
    (selectNode ? selectClickedNode(view, inside) : selectClickedLeaf(view, inside))
}

function handleDoubleClick(view, pos, inside, event) {
  return runHandlerOnContext(view, "handleDoubleClickOn", pos, inside, event) ||
    view.someProp("handleDoubleClick", f => f(view, pos, event))
}

function handleTripleClick(view, pos, inside, event) {
  return runHandlerOnContext(view, "handleTripleClickOn", pos, inside, event) ||
    view.someProp("handleTripleClick", f => f(view, pos, event)) ||
    defaultTripleClick(view, inside)
}

function defaultTripleClick(view, inside) {
  let doc = view.state.doc
  if (inside == -1) {
    if (doc.inlineContent) {
      updateSelection(view, TextSelection.create(doc, 0, doc.content.size), "pointer")
      return true
    }
    return false
  }

  let $pos = doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    let nodePos = $pos.before(i)
    if (node.inlineContent)
      updateSelection(view, TextSelection.create(doc, nodePos + 1, nodePos + 1 + node.content.size), "pointer")
    else if (NodeSelection.isSelectable(node))
      updateSelection(view, NodeSelection.create(doc, nodePos), "pointer")
    else
      continue
    return true
  }
}

function forceDOMFlush(view) {
  if (!view.inDOMChange) return false
  view.inDOMChange.finish(true)
  return true
}

const selectNodeModifier = browser.mac ? "metaKey" : "ctrlKey"

handlers.mousedown = (view, event) => {
  view.shiftKey = event.shiftKey
  let flushed = forceDOMFlush(view)
  let now = Date.now(), type = "singleClick"
  if (now - view.lastClick.time < 500 && isNear(event, view.lastClick) && !event[selectNodeModifier]) {
    if (view.lastClick.type == "singleClick") type = "doubleClick"
    else if (view.lastClick.type == "doubleClick") type = "tripleClick"
  }
  view.lastClick = {time: now, x: event.clientX, y: event.clientY, type}

  let pos = view.posAtCoords(eventCoords(event))
  if (!pos) return

  if (type == "singleClick")
    view.mouseDown = new MouseDown(view, pos, event, flushed)
  else if ((type == "doubleClick" ? handleDoubleClick : handleTripleClick)(view, pos.pos, pos.inside, event))
    event.preventDefault()
  else
    view.selectionReader.poll("pointer")
}

class MouseDown {
  constructor(view, pos, event, flushed) {
    this.view = view
    this.pos = pos
    this.event = event
    this.flushed = flushed
    this.selectNode = event[selectNodeModifier]
    this.allowDefault = event.shiftKey

    let targetNode, targetPos
    if (pos.inside > -1) {
      targetNode = view.state.doc.nodeAt(pos.inside)
      targetPos = pos.inside
    } else {
      let $pos = view.state.doc.resolve(pos.pos)
      targetNode = $pos.parent
      targetPos = $pos.depth ? $pos.before() : 0
    }

    this.mightDrag = null

    const target = flushed ? null : event.target
    const targetDesc = target ? view.docView.nearestDesc(target, true) : null
    this.target = targetDesc ? targetDesc.dom : null

    if (targetNode.type.spec.draggable && targetNode.type.spec.selectable !== false ||
        view.state.selection instanceof NodeSelection && targetPos == view.state.selection.from)
      this.mightDrag = {node: targetNode,
                        pos: targetPos,
                        addAttr: this.target && !this.target.draggable,
                        setUneditable: this.target && browser.gecko && !this.target.hasAttribute("contentEditable")}

    if (this.target && this.mightDrag && (this.mightDrag.addAttr || this.mightDrag.setUneditable)) {
      this.view.domObserver.stop()
      if (this.mightDrag.addAttr) this.target.draggable = true
      if (this.mightDrag.setUneditable)
        setTimeout(() => this.target.setAttribute("contentEditable", "false"), 20)
      this.view.domObserver.start()
    }

    view.root.addEventListener("mouseup", this.up = this.up.bind(this))
    view.root.addEventListener("mousemove", this.move = this.move.bind(this))
    view.selectionReader.poll("pointer")
  }

  done() {
    this.view.root.removeEventListener("mouseup", this.up)
    this.view.root.removeEventListener("mousemove", this.move)
    if (this.mightDrag && this.target) {
      this.view.domObserver.stop()
      if (this.mightDrag.addAttr) this.target.draggable = false
      if (this.mightDrag.setUneditable) this.target.removeAttribute("contentEditable")
      this.view.domObserver.start()
    }
    this.view.mouseDown = null
  }

  up(event) {
    this.done()

    if (!this.view.dom.contains(event.target.nodeType == 3 ? event.target.parentNode : event.target))
      return

    if (this.allowDefault) {
      // Force a cursor wrapper redraw if this was suppressed (to avoid an issue with IE drag-selection)
      if (browser.ie && needsCursorWrapper(this.view.state)) this.view.updateState(this.view.state)
      this.view.selectionReader.poll("pointer")
    } else if (handleSingleClick(this.view, this.pos.pos, this.pos.inside, event, this.selectNode)) {
      event.preventDefault()
    } else if (this.flushed ||
               // Chrome will sometimes treat a node selection as a
               // cursor, but still report that the node is selected
               // when asked through getSelection. You'll then get a
               // situation where clicking at the point where that
               // (hidden) cursor is doesn't change the selection, and
               // thus doesn't get a reaction from ProseMirror. This
               // works around that.
               (browser.chrome && !(this.view.state.selection instanceof TextSelection) &&
                (this.pos.pos == this.view.state.selection.from || this.pos.pos == this.view.state.selection.to))) {
      updateSelection(this.view, Selection.near(this.view.state.doc.resolve(this.pos.pos)), "pointer")
      event.preventDefault()
    } else {
      this.view.selectionReader.poll("pointer")
    }
  }

  move(event) {
    if (!this.allowDefault && (Math.abs(this.event.x - event.clientX) > 4 ||
                               Math.abs(this.event.y - event.clientY) > 4))
      this.allowDefault = true
    this.view.selectionReader.poll("pointer")
  }
}

handlers.touchdown = view => {
  forceDOMFlush(view)
  view.selectionReader.poll("pointer")
}

handlers.contextmenu = view => forceDOMFlush(view)

// Input compositions are hard. Mostly because the events fired by
// browsers are A) very unpredictable and inconsistent, and B) not
// cancelable.
//
// ProseMirror has the problem that it must not update the DOM during
// a composition, or the browser will cancel it. What it does is keep
// long-running operations (delayed DOM updates) when a composition is
// active.
//
// We _do not_ trust the information in the composition events which,
// apart from being very uninformative to begin with, is often just
// plain wrong. Instead, when a composition ends, we parse the dom
// around the original selection, and derive an update from that.

editHandlers.compositionstart = editHandlers.compositionupdate = view => {
  DOMChange.start(view, true)
}

editHandlers.compositionend = (view, e) => {
  if (!view.inDOMChange) {
    // We received a compositionend without having seen any previous
    // events for the composition. If there's data in the event
    // object, we assume that it's a real change, and start a
    // composition. Otherwise, we just ignore it.
    if (e.data) DOMChange.start(view, true)
    else return
  }

  view.inDOMChange.compositionEnd(e)
}

editHandlers.input = view => {
  let change = DOMChange.start(view)
  if (!change.composing) change.finish()
}

function captureCopy(view, dom) {
  // The extra wrapper is somehow necessary on IE/Edge to prevent the
  // content from being mangled when it is put onto the clipboard
  let doc = dom.ownerDocument
  let wrap = doc.body.appendChild(doc.createElement("div"))
  wrap.appendChild(dom)
  wrap.style.cssText = "position: fixed; left: -10000px; top: 10px"
  let sel = getSelection(), range = doc.createRange()
  range.selectNodeContents(dom)
  // Done because IE will fire a selectionchange moving the selection
  // to its start when removeAllRanges is called and the editor still
  // has focus (which will mess up the editor's selection state).
  view.dom.blur()
  sel.removeAllRanges()
  sel.addRange(range)
  setTimeout(() => {
    doc.body.removeChild(wrap)
    view.focus()
  }, 50)
}

// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
const brokenClipboardAPI = (browser.ie && browser.ie_version < 15) ||
      (browser.ios && browser.webkit_version < 604)

handlers.copy = editHandlers.cut = (view, e) => {
  let sel = view.state.selection, cut = e.type == "cut"
  if (sel.empty) return

  // IE and Edge's clipboard interface is completely broken
  let data = brokenClipboardAPI ? null : e.clipboardData
  let slice = sel.content(), {dom, text} = serializeForClipboard(view, slice)
  if (data) {
    e.preventDefault()
    data.clearData()
    data.setData("text/html", dom.innerHTML)
    data.setData("text/plain", text)
  } else {
    captureCopy(view, dom)
  }
  if (cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"))
}

function sliceSingleNode(slice) {
  return slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1 ? slice.content.firstChild : null
}

function capturePaste(view, e) {
  let doc = view.dom.ownerDocument
  let plainText = view.shiftKey || view.state.selection.$from.parent.type.spec.code
  let target = doc.body.appendChild(doc.createElement(plainText ? "textarea" : "div"))
  if (!plainText) target.contentEditable = "true"
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.focus()
  setTimeout(() => {
    view.focus()
    doc.body.removeChild(target)
    if (plainText) doPaste(view, target.value, null, e)
    else doPaste(view, target.textContent, target.innerHTML, e)
  }, 50)
}

function doPaste(view, text, html, e) {
  let slice = parseFromClipboard(view, text, html, view.shiftKey, view.state.selection.$from)
  if (!slice) return false

  if (view.someProp("handlePaste", f => f(view, e, slice))) return true

  let singleNode = sliceSingleNode(slice)
  let tr = singleNode ? view.state.tr.replaceSelectionWith(singleNode, view.shiftKey) : view.state.tr.replaceSelection(slice)
  view.dispatch(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"))
  return true
}

editHandlers.paste = (view, e) => {
  let data = brokenClipboardAPI ? null : e.clipboardData
  if (data && (doPaste(view, data.getData("text/plain"), data.getData("text/html"), e) || data.files.length > 0))
    e.preventDefault()
  else
    capturePaste(view, e)
}

class Dragging {
  constructor(slice, move) {
    this.slice = slice
    this.move = move
  }
}

const dragCopyModifier = browser.mac ? "altKey" : "ctrlKey"

handlers.dragstart = (view, e) => {
  let mouseDown = view.mouseDown
  if (mouseDown) mouseDown.done()
  if (!e.dataTransfer) return

  let sel = view.state.selection
  let pos = sel.empty ? null : view.posAtCoords(eventCoords(e))
  if (pos && pos.pos >= sel.from && pos.pos <= (sel instanceof NodeSelection ? sel.to - 1: sel.to)) {
    // In selection
  } else if (mouseDown && mouseDown.mightDrag) {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, mouseDown.mightDrag.pos)))
  } else if (e.target && e.target.nodeType == 1) {
    let desc = view.docView.nearestDesc(e.target, true)
    if (!desc || !desc.node.type.spec.draggable || desc == view.docView) return
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, desc.posBefore)))
  }
  let slice = view.state.selection.content(), {dom, text} = serializeForClipboard(view, slice)
  e.dataTransfer.clearData()
  e.dataTransfer.setData(brokenClipboardAPI ? "Text" : "text/html", dom.innerHTML)
  if (!brokenClipboardAPI) e.dataTransfer.setData("text/plain", text)
  view.dragging = new Dragging(slice, !e[dragCopyModifier])
}

handlers.dragend = view => {
  window.setTimeout(() => view.dragging = null, 50)
}

editHandlers.dragover = editHandlers.dragenter = (_, e) => e.preventDefault()

editHandlers.drop = (view, e) => {
  let dragging = view.dragging
  view.dragging = null

  if (!e.dataTransfer) return

  let eventPos = view.posAtCoords(eventCoords(e))
  if (!eventPos) return
  let $mouse = view.state.doc.resolve(eventPos.pos)
  if (!$mouse) return
  let slice = dragging && dragging.slice ||
      parseFromClipboard(view, e.dataTransfer.getData(brokenClipboardAPI ? "Text" : "text/plain"),
                         brokenClipboardAPI ? null : e.dataTransfer.getData("text/html"), false, $mouse)
  if (!slice) return

  e.preventDefault()
  if (view.someProp("handleDrop", f => f(view, e, slice, dragging && dragging.move))) return
  let insertPos = slice ? dropPoint(view.state.doc, $mouse.pos, slice) : $mouse.pos
  if (insertPos == null) insertPos = $mouse.pos

  let tr = view.state.tr
  if (dragging && dragging.move) tr.deleteSelection()

  let pos = tr.mapping.map(insertPos)
  let isNode = slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1
  let beforeInsert = tr.doc
  if (isNode)
    tr.replaceRangeWith(pos, pos, slice.content.firstChild)
  else
    tr.replaceRange(pos, pos, slice)
  if (tr.doc.eq(beforeInsert)) return

  let $pos = tr.doc.resolve(pos)
  if (isNode && NodeSelection.isSelectable(slice.content.firstChild) &&
      $pos.nodeAfter && $pos.nodeAfter.sameMarkup(slice.content.firstChild))
    tr.setSelection(new NodeSelection($pos))
  else
    tr.setSelection(selectionBetween(view, $pos, tr.doc.resolve(tr.mapping.map(insertPos))))
  view.focus()
  view.dispatch(tr.setMeta("uiEvent", "drop"))
}

handlers.focus = view => {
  if (!view.focused) {
    view.dom.classList.add("ProseMirror-focused")
    view.focused = true
  }
}

handlers.blur = view => {
  if (view.focused) {
    view.dom.classList.remove("ProseMirror-focused")
    view.focused = false
  }
}

// Make sure all handlers get registered
for (let prop in editHandlers) handlers[prop] = editHandlers[prop]
