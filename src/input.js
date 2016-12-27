const {Selection, NodeSelection, TextSelection} = require("prosemirror-state")

const browser = require("./browser")
const {captureKeyDown} = require("./capturekeys")
const {DOMChange} = require("./domchange")
const {fromClipboard, toClipboard, canUpdateClipboard} = require("./clipboard")
const {TrackMappings} = require("./trackmappings")

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
const handlers = {}, editHandlers = {}

function initInput(view) {
  view.shiftKey = false
  view.mouseDown = null
  view.dragging = null
  view.inDOMChange = null
  view.mutationObserver = window.MutationObserver &&
    new window.MutationObserver(mutations => registerMutations(view, mutations))
  startObserving(view)

  for (let event in handlers) {
    let handler = handlers[event]
    view.content.addEventListener(event, event => {
      if ((view.editable || !(event.type in editHandlers)) &&
          eventBelongsToView(view, event) && !view.someProp("handleDOMEvent", f => f(view, event)))
        handler(view, event)
    })
  }
}
exports.initInput = initInput

function eventBelongsToView(view, event) {
  if (!event.bubbles) return true
  if (event.defaultPrevented) return false
  for (let node = event.target; node != view.content; node = node.parentNode)
    if (!node || node.nodeType == 11 ||
        (node.pmViewDesc && node.pmViewDesc.stopEvent(event)))
      return false
  return true
}

function dispatchEvent(view, event) {
  let handler = handlers[event.type]
  if (handler && !view.someProp("handleDOMEvent", f => f(view, event))) handler(view, event)
}
exports.dispatchEvent = dispatchEvent

editHandlers.keydown = (view, event) => {
  if (event.keyCode == 16) view.shiftKey = true
  if (view.inDOMChange) return
  if (view.someProp("handleKeyDown", f => f(view, event)) || captureKeyDown(view, event))
    event.preventDefault()
  else
    view.selectionReader.poll()
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

  let {node, $from, $to} = view.state.selection
  if (node || !$from.sameParent($to)) {
    let text = String.fromCharCode(event.charCode)
    if (!view.someProp("handleTextInput", f => f(view, $from.pos, $to.pos, text)))
      view.props.onAction(view.state.tr.insertText(text).scrollAction())
    event.preventDefault()
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
    if (view.someProp(propName, f => i > $pos.depth ? f(view, pos, $pos.nodeAfter, $pos.before(i), event, true)
                                                    : f(view, pos, $pos.node(i), $pos.before(i), event, false)))
      return true
  }
  return false
}

function updateSelection(view, selection, origin) {
  view.focus()
  view.props.onAction(selection.action({origin}))
}

function selectClickedLeaf(view, inside) {
  if (inside == -1) return false
  let $pos = view.state.doc.resolve(inside), node = $pos.nodeAfter
  if (node && node.isLeaf && NodeSelection.isSelectable(node)) {
    updateSelection(view, new NodeSelection($pos), "mouse")
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
    updateSelection(view, NodeSelection.create(view.state.doc, selectAt), "mouse")
    return true
  } else {
    return false
  }
}

function handleSingleClick(view, pos, inside, event) {
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
      updateSelection(view, TextSelection.create(doc, 0, doc.content.size), "mouse")
      return true
    }
    return false
  }

  let $pos = doc.resolve(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    let nodePos = $pos.before(i)
    if (node.isTextblock)
      updateSelection(view, TextSelection.create(doc, nodePos + 1, nodePos + 1 + node.content.size), "mouse")
    else if (NodeSelection.isSelectable(node))
      updateSelection(view, NodeSelection.create(doc, nodePos), "mouse")
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
  let flushed = forceDOMFlush(view)
  let now = Date.now(), type
  if (now - lastClick.time >= 500 || !isNear(event, lastClick) || event[selectNodeModifier]) type = "singleClick"
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
    view.selectionReader.poll("mouse")
}

class MouseDown {
  constructor(view, pos, event, flushed) {
    this.view = view
    this.pos = pos
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

    this.mightDrag = (targetNode.type.spec.draggable || targetNode == view.state.selection.node) ? {node: targetNode, pos: targetPos} : null
    this.target = flushed ? null : event.target
    if (this.target && this.mightDrag) {
      stopObserving(this.view)
      this.target.draggable = true
      if (browser.gecko && (this.setContentEditable = !this.target.hasAttribute("contentEditable")))
        this.target.setAttribute("contentEditable", "false")
      startObserving(this.view)
    }

    view.root.addEventListener("mouseup", this.up = this.up.bind(this))
    view.root.addEventListener("mousemove", this.move = this.move.bind(this))
    view.selectionReader.poll("mouse")
  }

  done() {
    this.view.root.removeEventListener("mouseup", this.up)
    this.view.root.removeEventListener("mousemove", this.move)
    if (this.mightDrag && this.target) {
      stopObserving(this.view)
      this.target.draggable = false
      if (browser.gecko && this.setContentEditable)
        this.target.removeAttribute("contentEditable")
      startObserving(this.view)
    }
  }

  up(event) {
    this.done()

    if (!this.view.content.contains(event.target.nodeType == 3 ? event.target.parentNode : event.target))
      return

    if (this.allowDefault) {
      this.view.selectionReader.poll("mouse")
    } else if (this.selectNode
               ? selectClickedNode(this.view, this.pos.inside)
               : handleSingleClick(this.view, this.pos.pos, this.pos.inside, event)) {
      event.preventDefault()
    } else if (this.flushed) {
      updateSelection(this.view, Selection.near(this.view.state.doc.resolve(this.pos.pos)), "mouse")
      event.preventDefault()
    } else {
      this.view.selectionReader.poll("mouse")
    }
  }

  move(event) {
    if (!this.allowDefault && (Math.abs(this.x - event.clientX) > 4 ||
                               Math.abs(this.y - event.clientY) > 4))
      this.allowDefault = true
    this.view.selectionReader.poll("mouse")
  }
}

handlers.touchdown = view => {
  forceDOMFlush(view)
  view.selectionReader.poll("mouse")
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

editHandlers.compositionstart = editHandlers.compositionupdate = view => {
  DOMChange.start(view, true)
  if (view.state.storedMarks) view.inDOMChange.finish(true)
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

  view.inDOMChange.compositionEnd()
}

const observeOptions = {childList: true, characterData: true, attributes: true, subtree: true}
function startObserving(view) {
  if (view.mutationObserver) view.mutationObserver.observe(view.content, observeOptions)
}
exports.startObserving = startObserving

function stopObserving(view) {
  if (view.mutationObserver) view.mutationObserver.disconnect()
}
exports.stopObserving = stopObserving

function registerMutations(view, mutations) {
  if (view.editable) for (let i = 0; i < mutations.length; i++) {
    let mut = mutations[i], desc = view.docView.nearestDesc(mut.target)
    if (desc == view.docView && mut.type == "attributes") continue
    if (!desc || desc.ignoreMutation(mut)) continue

    let from, to
    if (mut.type == "childList") {
      let fromOffset = mut.previousSibling && mut.previousSibling.parentNode == mut.target
          ? Array.prototype.indexOf.call(mut.target.childNodes, desc.previousSibling) + 1 : 0
      from = desc.localPosFromDOM(mut.target, fromOffset, -1)
      let toOffset = mut.nextSibling && mut.nextSibling.parentNode == mut.target
          ? Array.prototype.indexOf.call(mut.target.childNodes, desc.nextSibling) : mut.target.childNodes.length
      to = desc.localPosFromDOM(mut.target, toOffset, 1)
    } else if (mut.type == "attributes") {
      from = desc.posAtStart - desc.border
      to = desc.posAtEnd + desc.border
    } else { // "characterData"
      from = desc.posAtStart
      to = desc.posAtEnd
    }

    DOMChange.start(view)
    view.inDOMChange.addRange(from, to)
  }
}

editHandlers.input = view => DOMChange.start(view)

handlers.copy = editHandlers.cut = (view, e) => {
  let sel = view.state.selection, cut = e.type == "cut"
  if (sel.empty) return
  if (!e.clipboardData || !canUpdateClipboard(e.clipboardData)) {
    if (cut && browser.ie && browser.ie_version <= 11) DOMChange.start(view)
    return
  }
  toClipboard(view, sel, e.clipboardData)
  e.preventDefault()
  if (cut) view.props.onAction(view.state.tr.deleteRange(sel.from, sel.to).scrollAction())
}

function sliceSingleNode(slice) {
  return slice.openLeft == 0 && slice.openRight == 0 && slice.content.childCount == 1 ? slice.content.firstChild : null
}

editHandlers.paste = (view, e) => {
  if (!e.clipboardData) {
    if (browser.ie && browser.ie_version <= 11) DOMChange.start(view)
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
  constructor(state, slice, range, move) {
    this.slice = slice
    this.range = range
    this.move = move && new TrackMappings(state)
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
    view.dragging = new Dragging(view.state, slice, draggedRange, !e.ctrlKey)
  }
}

handlers.dragend = view => {
  window.setTimeout(() => view.dragging = null, 50)
}

editHandlers.dragover = editHandlers.dragenter = (_, e) => e.preventDefault()

editHandlers.dragleave = () => null

editHandlers.drop = (view, e) => {
  let dragging = view.dragging
  view.dragging = null

  if (!e.dataTransfer) return

  let $mouse = view.state.doc.resolve(view.posAtCoords(eventCoords(e)).pos)
  if (!$mouse) return
  let slice = dragging && dragging.slice || fromClipboard(view, e.dataTransfer, false, $mouse)
  if (!slice) return
  let insertPos = dropPos(slice, view.state.doc.resolve($mouse.pos))

  e.preventDefault()
  let tr = view.state.tr
  if (dragging && dragging.move) {
    let {from, to} = dragging.range, mapping = dragging.move.getMapping(view.state)
    if (mapping) tr.deleteRange(mapping.map(from, 1), mapping.map(to, -1))
  }
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
  if (!view.focused) {
    view.content.classList.add("ProseMirror-focused")
    view.focused = true
  }
  view.someProp("onFocus", f => { f(view, event) })
}

handlers.blur = (view, event) => {
  if (view.focused) {
    view.content.classList.remove("ProseMirror-focused")
    view.focused = false
  }
  view.someProp("onBlur", f => { f(view, event) })
}

// Make sure all handlers get registered
for (let prop in editHandlers) handlers[prop] = editHandlers[prop]
