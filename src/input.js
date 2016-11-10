const {Selection, NodeSelection, TextSelection} = require("prosemirror-state")

const browser = require("./browser")
const {captureKeyDown} = require("./capturekeys")
const {readInputChange, readCompositionChange} = require("./domchange")
const {fromClipboard, toClipboard, canUpdateClipboard} = require("./clipboard")

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
const handlers = {}

function initInput(view) {
  view.shiftKey = false
  view.mouseDown = null
  view.dragging = null
  view.dropTarget = null
  view.finishUpdateFromDOM = null
  view.inDOMChange = null

  for (let event in handlers) {
    let handler = handlers[event]
    view.content.addEventListener(event, e => {
      if (!view.someProp("handleDOMEvent", f => f(view, e)))
        handler(view, e)
    })
  }
}
exports.initInput = initInput

function dispatchKeyDown(view, event) {
  return view.someProp("handleKeyDown", f => f(view, event)) || captureKeyDown(view, event)
}
exports.dispatchKeyDown = dispatchKeyDown

handlers.keydown = (view, e) => {
  if (e.keyCode == 16) view.shiftKey = true
  if (!view.hasFocus() || view.inDOMChange) return
  if (dispatchKeyDown(view, e))
    e.preventDefault()
  else
    view.selectionReader.fastPoll()
}

handlers.keyup = (view, e) => {
  if (e.keyCode == 16) view.shiftKey = false
}

function insertText(view, text) {
  let {from, to} = view.state.selection
  if (!view.someProp("handleTextInput", f => f(view, from, to, text)))
    view.props.onAction(view.state.tr.insertText(text).scrollAction())
}

function dispatchKeyPress(view, event) {
  return view.someProp("handleKeyPress", f => f(view, event))
}
exports.dispatchKeyPress = dispatchKeyPress

handlers.keypress = (view, e) => {
  if (!view.hasFocus() || view.inDOMChange || !e.charCode ||
      e.ctrlKey && !e.altKey || browser.mac && e.metaKey) return
  if (dispatchKeyPress(view, e)) {
    e.preventDefault()
    return
  }

  // On iOS, let input through, because if we handle it the virtual
  // keyboard's default case doesn't update (it only does so when the
  // user types or taps, not on selection updates from JavaScript).
  if (!browser.ios) {
    insertText(view, String.fromCharCode(e.charCode))
    e.preventDefault()
  }
}

function eventCoords(event) { return {left: event.clientX, top: event.clientY} }

let lastClick = {time: 0, x: 0, y: 0}, oneButLastClick = lastClick

function isNear(event, click) {
  let dx = click.x - event.clientX, dy = click.y - event.clientY
  return dx * dx + dy * dy < 100
}

function runHandlerOnContext(view, propName, pos, inside, event) {
  if (inside == -1) return false
  let $pos = view.state.doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (view.someProp(propName, f => f(view, pos, node, $pos.before(i), event)))
      return true
  }
  return false
}

function updateSelection(view, selection) {
  view.focus()
  view.props.onAction(selection.action())
}

function selectClickedLeaf(view, inside) {
  if (inside == -1) return false
  let $pos = view.state.doc.resolve(inside), node = $pos.nodeAfter
  if (node && node.isLeaf && NodeSelection.isSelectable(node)) {
    updateSelection(view, new NodeSelection($pos))
    return true
  }
  return false
}

function selectClickedNode(view, inside) {
  if (inside == -1) return false
  let {node: selectedNode, $from} = view.state.selection, selectAt

  let $pos = view.state.doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (NodeSelection.isSelectable(node)) {
     if (selectedNode && $from.depth > 0 &&
          i >= $from.depth && $pos.before($from.depth + 1) == $from.pos)
        selectAt = $pos.before($from.depth)
      else
        selectAt = $pos.before(i)
      break
    }
  }

  if (selectAt != null) {
    updateSelection(view, NodeSelection.create(view.state.doc, selectAt))
    return true
  } else {
    return false
  }
}

function handleSingleClick(view, pos, inside, ctrl, event) {
  if (ctrl) return selectClickedNode(view, inside)

  return runHandlerOnContext(view, "handleClickOn", pos, inside, event) ||
    view.someProp("handleClick", f => f(view, pos, event)) ||
    selectClickedLeaf(view, inside)
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
    if (doc.isTextblock) {
      updateSelection(view, TextSelection.create(doc, 0, doc.content.size))
      return true
    }
    return false
  }

  let $pos = doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    let nodePos = $pos.before(i)
    if (node.isTextblock)
      updateSelection(view, TextSelection.create(doc, nodePos + 1, nodePos + 1 + node.content.size))
    else if (NodeSelection.isSelectable(node))
      updateSelection(view, NodeSelection.create(doc, nodePos))
    else
      continue
    return true
  }
}

function forceDOMFlush(view) {
  if (!view.inDOMChange) return false
  finishUpdateFromDOM(view)
  return true
}

handlers.mousedown = (view, event) => {
  let flushed = forceDOMFlush(view)
  let now = Date.now(), type
  if (now - lastClick.time >= 500 || !isNear(event, lastClick) || event.ctrlKey) type = "singleClick"
  else if (now - oneButLastClick.time >= 600 || !isNear(event, oneButLastClick)) type = "doubleClick"
  else type = "tripleClick"
  oneButLastClick = lastClick
  lastClick = {time: now, x: event.clientX, y: event.clientY}

  let pos = view.posAtCoords(eventCoords(event))
  if (!pos) return

  if (type == "singleClick")
    view.mouseDown = new MouseDown(view, pos, event, flushed)
  else if ((type == "doubleClick" ? handleDoubleClick : handleTripleClick)(view, pos.pos, pos.inside, event))
    event.preventDefault()
  else
    view.selectionReader.fastPoll()
}

class MouseDown {
  constructor(view, pos, event, flushed) {
    this.view = view
    this.pos = pos
    this.flushed = flushed
    this.ctrlKey = event.ctrlKey
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

    this.mightDrag = (targetNode.type.spec.draggable || targetNode == view.state.selection.node) ? {node: targetNode, pos: targetPos} : null
    this.target = flushed ? null : event.target
    if (this.target && this.mightDrag) {
      this.target.draggable = true
      if (browser.gecko && (this.setContentEditable = !this.target.hasAttribute("contentEditable")))
        this.target.setAttribute("contentEditable", "false")
    }

    view.root.addEventListener("mouseup", this.up = this.up.bind(this))
    view.root.addEventListener("mousemove", this.move = this.move.bind(this))
    view.selectionReader.fastPoll()
  }

  done() {
    this.view.root.removeEventListener("mouseup", this.up)
    this.view.root.removeEventListener("mousemove", this.move)
    if (this.mightDrag && this.target) {
      this.target.draggable = false
      if (browser.gecko && this.setContentEditable)
        this.target.removeAttribute("contentEditable")
    }
  }

  up(event) {
    this.done()

    if (!this.view.content.contains(event.target.nodeType == 3 ? event.target.parentNode : event.target))
      return

    if (this.allowDefault) {
      this.view.selectionReader.fastPoll()
    } else if (handleSingleClick(this.view, this.pos.pos, this.pos.inside, this.ctrlKey, event)) {
      event.preventDefault()
    } else if (this.flushed) {
      this.view.focus()
      this.view.props.onAction(Selection.near(this.view.state.doc.resolve(this.pos.pos)).action())
      event.preventDefault()
    } else {
      this.view.selectionReader.fastPoll()
    }
  }

  move(event) {
    if (!this.allowDefault && (Math.abs(this.x - event.clientX) > 4 ||
                               Math.abs(this.y - event.clientY) > 4))
      this.allowDefault = true
    this.view.selectionReader.fastPoll()
  }
}

handlers.touchdown = view => {
  forceDOMFlush(view)
  view.selectionReader.fastPoll()
}

handlers.contextmenu = (view, e) => {
  forceDOMFlush(view)
  let pos = view.posAtCoords(eventCoords(e))
  if (pos && view.someProp("handleContextMenu", f => f(view, pos.pos, e)))
    e.preventDefault()
}

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

function startComposition(view, dataLen) {
  view.inDOMChange = {id: domChangeID(), state: view.state,
                      composition: true, composeMargin: dataLen}
  clearTimeout(view.finishUpdateFromDOM)
  view.props.onAction({type: "startDOMChange", id: view.inDOMChange.id})
}

function domChangeID() {
  return Math.floor(Math.random() * 0xffffffff)
}

function scheduleUpdateFromDOM(view) {
  clearTimeout(view.finishUpdateFromDOM)
  // Give the browser a moment to fire input events or start a new
  // composition, and only apply the change from the DOM afterwards.
  view.finishUpdateFromDOM = window.setTimeout(() => finishUpdateFromDOM(view), 50)
}

handlers.compositionstart = (view, e) => {
  if (!view.inDOMChange && view.hasFocus())
    startComposition(view, e.data ? e.data.length : 0)
}

handlers.compositionupdate = view => {
  if (!view.inDOMChange && view.hasFocus())
    startComposition(view, 0)
}

handlers.compositionend = (view, e) => {
  if (!view.hasFocus()) return
  if (!view.inDOMChange) {
    // We received a compositionend without having seen any previous
    // events for the composition. If there's data in the event
    // object, we assume that it's a real change, and start a
    // composition. Otherwise, we just ignore it.
    if (e.data) startComposition(view, e.data.length)
    else return
  }

  scheduleUpdateFromDOM(view)
}

function finishUpdateFromDOM(view) {
  clearTimeout(view.finishUpdateFromDOM)
  let change = view.inDOMChange
  if (!change) return
  if (change.composition) readCompositionChange(view, change.state, change.composeMargin)
  else readInputChange(view, change.state)
  view.inDOMChange = null
  view.props.onAction({type: "endDOMChange"})
}
exports.finishUpdateFromDOM = finishUpdateFromDOM

handlers.input = view => {
  if (view.inDOMChange || !view.hasFocus()) return
  view.inDOMChange = {id: domChangeID(), state: view.state}
  view.props.onAction({type: "startDOMChange", id: view.inDOMChange.id})
  scheduleUpdateFromDOM(view)
}

handlers.copy = handlers.cut = (view, e) => {
  let sel = view.state.selection, cut = e.type == "cut"
  if (sel.empty) return
  if (!e.clipboardData || !canUpdateClipboard(e.clipboardData)) {
    if (cut && browser.ie && browser.ie_version <= 11) scheduleUpdateFromDOM(view)
    return
  }
  toClipboard(view, sel, e.clipboardData)
  e.preventDefault()
  if (cut) view.props.onAction(view.state.tr.deleteRange(sel.from, sel.to).scrollAction())
}

function sliceSingleNode(slice) {
  return slice.openLeft == 0 && slice.openRight == 0 && slice.content.childCount == 1 ? slice.content.firstChild : null
}

handlers.paste = (view, e) => {
  if (!view.hasFocus()) return
  if (!e.clipboardData) {
    if (browser.ie && browser.ie_version <= 11) scheduleUpdateFromDOM(view)
    return
  }
  let slice = fromClipboard(view, e.clipboardData, view.shiftKey, view.state.selection.$from)
  if (slice) {
    e.preventDefault()
    view.someProp("transformPasted", f => { slice = f(slice) })
    let singleNode = sliceSingleNode(slice)
    let tr = singleNode ? view.state.tr.replaceSelectionWith(singleNode) : view.state.tr.replaceSelection(slice)
    view.props.onAction(tr.scrollAction())
  }
}

class Dragging {
  constructor(slice, range, move) {
    this.slice = slice
    this.range = range
    this.move = move
  }
}

function dropPos(slice, $pos) {
  if (!slice || !slice.content.size) return $pos.pos
  let content = slice.content
  for (let i = 0; i < slice.openLeft; i++) content = content.firstChild.content
  for (let d = $pos.depth; d >= 0; d--) {
    let bias = d == $pos.depth ? 0 : $pos.pos <= ($pos.start(d + 1) + $pos.end(d + 1)) / 2 ? -1 : 1
    let insertPos = $pos.index(d) + (bias > 0 ? 1 : 0)
    if ($pos.node(d).canReplace(insertPos, insertPos, content))
      return bias == 0 ? $pos.pos : bias < 0 ? $pos.before(d + 1) : $pos.after(d + 1)
  }
  return $pos.pos
}

function removeDropTarget(view) {
  if (view.dropTarget) {
    view.wrapper.removeChild(view.dropTarget)
    view.dropTarget = null
  }
}

handlers.dragstart = (view, e) => {
  let mouseDown = view.mouseDown
  if (mouseDown) mouseDown.done()
  if (!e.dataTransfer) return

  let sel = view.state.selection, draggedRange
  let pos = sel.empty ? null : view.posAtCoords(eventCoords(e))
  if (pos != null && pos.pos >= sel.from && pos.pos <= sel.to)
    draggedRange = sel
  else if (mouseDown && mouseDown.mightDrag)
    draggedRange = NodeSelection.create(view.state.doc, mouseDown.mightDrag.pos)

  if (draggedRange) {
    let slice = toClipboard(view, draggedRange, e.dataTransfer)
    view.dragging = new Dragging(slice, draggedRange, !e.ctrlKey)
  }
}

handlers.dragend = view => {
  removeDropTarget(view)
  window.setTimeout(() => view.dragging = null, 50)
}

handlers.dragover = handlers.dragenter = (view, e) => {
  e.preventDefault()

  let target = view.dropTarget
  if (!target) {
    target = view.dropTarget = view.wrapper.appendChild(document.createElement("div"))
    target.className = "ProseMirror-drop-target"
  }

  let pos = dropPos(view.dragging && view.dragging.slice,
                    view.state.doc.resolve(view.posAtCoords(eventCoords(e)).pos))
  if (pos == null) return
  let coords = view.coordsAtPos(pos)
  let rect = view.wrapper.getBoundingClientRect()
  coords.top -= rect.top
  coords.right -= rect.left
  coords.bottom -= rect.top
  coords.left -= rect.left
  target.style.left = (coords.left - 1) + "px"
  target.style.top = coords.top + "px"
  target.style.height = (coords.bottom - coords.top) + "px"
}

handlers.dragleave = (view, e) => {
  if (e.target == view.content) removeDropTarget(view)
}

handlers.drop = (view, e) => {
  let dragging = view.dragging
  view.dragging = null
  removeDropTarget(view)

  if (!e.dataTransfer) return

  let $mouse = view.state.doc.resolve(view.posAtCoords(eventCoords(e)).pos)
  if (!$mouse) return
  let slice = dragging && dragging.slice || fromClipboard(view, e.dataTransfer, false, $mouse)
  if (!slice) return
  let insertPos = dropPos(slice, view.state.doc.resolve($mouse.pos))

  e.preventDefault()
  let tr = view.state.tr
  if (dragging && dragging.move)
    tr.deleteRange(dragging.range.from, dragging.range.to)
  view.someProp("transformPasted", f => { slice = f(slice) })
  let pos = tr.mapping.map(insertPos)
  if (slice.openLeft == 0 && slice.openRight == 0 && slice.content.childCount == 1)
    tr.replaceRangeWith(pos, pos, slice.content.firstChild)
  else
    tr.replaceRange(pos, pos, slice)
  tr.setSelection(Selection.between(tr.doc.resolve(pos), tr.doc.resolve(tr.mapping.map(insertPos))))
  view.focus()
  view.props.onAction(tr.action())
}

handlers.focus = (view, event) => {
  view.wrapper.classList.add("ProseMirror-focused")
  view.someProp("onFocus", f => { f(view, event) })
}

handlers.blur = (view, event) => {
  view.wrapper.classList.remove("ProseMirror-focused")
  view.someProp("onBlur", f => { f(view, event) })
}
