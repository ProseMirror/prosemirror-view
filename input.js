const Keymap = require("browserkeymap")
const browser = require("../util/browser")
const {Slice, Fragment, parseDOMInContext} = require("../model")
const {Selection, NodeSelection, TextSelection} = require("../state")

const {elt, contains} = require("../util/dom")

const {readInputChange, readCompositionChange} = require("./domchange")

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
const handlers = {}

function initInput(view) {
  view.shiftKey = false
  view.keyPrefix = null
  view.clearPrefix = null
  view.mouseDown = null
  view.dragging = null
  view.dropTarget = null
  view.finishUpdateFromDOM = null
  view.inDOMChange = null

  for (let event in handlers) {
    let handler = handlers[event]
    view.content.addEventListener(event, e => handler(view, e))
  }
}
exports.initInput = initInput

function dispatchKey(view, keyName) {
  let prefix = view.keyPrefix
  // If the previous key should be used in sequence with this one, modify the name accordingly.
  if (prefix) {
    if (Keymap.isModifierKey(keyName)) return true
    clearTimeout(view.clearPrefix)
    view.clearPrefix = setTimeout(function() {
      if (view.keyPrefix == prefix) view.keyPrefix = null
    }, 50)
    keyName = prefix + " " + keyName
  }

  let state = view.applyKey(keyName)
  if (!state) return false
  if (state != view.state) view.props.onChange(state)
  return true
}

handlers.keydown = (view, e) => {
  if (e.keyCode == 16) view.shiftKey = true
  if (!view.hasFocus() || view.inDOMChange) return
  let name = Keymap.keyName(e)
  if (name && dispatchKey(view, name))
    e.preventDefault()
  else
    view.selectionReader.fastPoll()
}

handlers.keyup = (view, e) => {
  if (e.keyCode == 16) view.shiftKey = false
}

handlers.keypress = (view, e) => {
  if (!view.hasFocus() || view.inDOMChange || !e.charCode ||
      e.ctrlKey && !e.altKey || browser.mac && e.metaKey) return
  if (dispatchKey(view, Keymap.keyName(e))) {
    e.preventDefault()
    return
  }

  // On iOS, let input through, because if we handle it the virtual
  // keyboard's default case doesn't update (it only does so when the
  // user types or taps, not on selection updates from JavaScript).
  if (!browser.ios) {
    view.props.onChange(view.insertText(String.fromCharCode(e.charCode)))
    e.preventDefault()
  }
}

function eventCoords(event) { return {left: event.clientX, top: event.clientY} }

let lastClick = {time: 0, x: 0, y: 0}, oneButLastClick = lastClick

function isNear(event, click) {
  let dx = click.x - event.clientX, dy = click.y - event.clientY
  return dx * dx + dy * dy < 100
}

function runHandlerOnContext(view, propName, pos, inside) {
  let $pos = view.state.doc.resolve(inside == null ? pos : inside)
  for (let i = $pos.depth + (inside == null ? 0 : 1); i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (view.someProp(propName, f => f(view, pos, node, $pos.before(i))))
      return true
  }
  return false
}

function updateSelection(view, selection) {
  view.focus()
  view.props.onChange(view.state.applySelection(selection))
}

function selectClickedLeaf(view, inside) {
  let leaf = view.state.doc.nodeAt(inside)
  if (leaf && leaf.type.isLeaf && leaf.type.selectable) {
    updateSelection(view, new NodeSelection(view.state.doc.resolve(inside)))
    return true
  }
}

function selectClickedNode(view, pos, inside) {
  let {node: selectedNode, $from} = view.state.selection, selectAt

  let $pos = view.state.doc.resolve(inside == null ? pos : inside)
  for (let i = $pos.depth + (inside == null ? 0 : 1); i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    if (node.type.selectable) {
     if (selectedNode && $from.depth > 0 &&
          i >= $from.depth && $pos.before($from.depth + 1) == $from.pos)
        selectAt = $pos.before($from.depth)
      else
        selectAt = $pos.before(i)
      break
    }
  }

  if (selectAt != null) {
    updateSelection(view, new NodeSelection(view.state.doc.resolve(selectAt)))
    return true
  } else {
    return false
  }
}

function handleSingleClick(view, pos, inside, ctrl) {
  if (ctrl) return selectClickedNode(view, pos, inside)

  return runHandlerOnContext(view, "handleClickOn", pos, inside) ||
    view.someProp("handleClick", f => f(view, pos)) ||
    inside != null && selectClickedLeaf(view, inside)
}

function handleDoubleClick(view, pos, inside) {
  return runHandlerOnContext(view, "handleDoubleClickOn", pos, inside) ||
    view.someProp("handleDoubleClick", f => f(view, pos))
}

function handleTripleClick(view, pos, inside) {
  return runHandlerOnContext(view, "handleTripleClickOn", pos, inside) ||
    view.someProp("handleTripleClick", f => f(view, pos)) ||
    defaultTripleClick(view, pos, inside)
}

function defaultTripleClick(view, pos, inside) {
  let doc = view.state.doc, $pos = doc.resolve(inside == null ? pos : inside)
  for (let i = $pos.depth + (inside == null ? 0 : 1); i > 0; i--) {
    let node = i > $pos.depth ? $pos.nodeAfter : $pos.node(i)
    let nodePos = $pos.before(i)
    if (node.isTextblock)
      updateSelection(view, new TextSelection(doc.resolve(nodePos + 1),
                                            doc.resolve(nodePos + 1 + node.content.size)))
    else if (node.type.selectable)
      updateSelection(view, new NodeSelection(doc.resolve(nodePos)))
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
  if (now - lastClick.time >= 500 || !isNear(event, lastClick)) type = "singleClick"
  else if (now - oneButLastClick.time >= 600 || !isNear(event, oneButLastClick)) type = "doubleClick"
  else type = "tripleClick"
  oneButLastClick = lastClick
  lastClick = {time: now, x: event.clientX, y: event.clientY}

  let pos = view.posAtCoords(eventCoords(event))
  if (!pos) return

  if (type == "singleClick")
    view.mouseDown = new MouseDown(view, pos, event, flushed)
  else if ((type == "doubleClick" ? handleDoubleClick : handleTripleClick)(view, pos.pos, pos.inside))
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
    this.allowDefault = view.shiftKey

    let targetNode
    if (pos.inside) targetNode = view.state.doc.nodeAt(pos.inside)
    else targetNode = view.state.doc.resolve(pos.pos).parent

    this.mightDrag = (targetNode.type.draggable || targetNode == view.state.selection.node) ? targetNode : null
    this.target = flushed ? null : event.target
    if (this.target && this.mightDrag) {
      this.target.draggable = true
      if (browser.gecko && (this.setContentEditable = !this.target.hasAttribute("contentEditable")))
        this.target.setAttribute("contentEditable", "false")
    }

    window.addEventListener("mouseup", this.up = this.up.bind(this))
    window.addEventListener("mousemove", this.move = this.move.bind(this))
    view.selectionReader.fastPoll()
  }

  done() {
    window.removeEventListener("mouseup", this.up)
    window.removeEventListener("mousemove", this.move)
    if (this.mightDrag && this.target) {
      this.target.draggable = false
      if (browser.gecko && this.setContentEditable)
        this.target.removeAttribute("contentEditable")
    }
  }

  up(event) {
    this.done()

    if (!contains(this.view.content, event.target)) return

    if (this.allowDefault) {
      this.view.selectionReader.fastPoll()
    } else if (handleSingleClick(this.view, this.pos.pos, this.pos.inside, this.ctrlKey)) {
      event.preventDefault()
    } else if (this.flushed) {
      this.view.focus()
      this.view.props.onChange(this.view.state.applySelection(Selection.near(this.view.state.doc.resolve(this.pos.pos))))
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
  if (pos && view.someProp("handleContextMenu", f => f(view, pos.pos)))
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
  view.props.onChange(view.startDOMChange(view.inDOMChange.id))
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
  let state = (change.composition
               ? readCompositionChange(view, change.state, change.composeMargin)
               : readInputChange(view, change.state)) || view.state
  view.inDOMChange = null
  view.props.onChange(state.endDOMChange())
}
exports.finishUpdateFromDOM = finishUpdateFromDOM

handlers.input = view => {
  if (view.inDOMChange || !view.hasFocus()) return
  view.inDOMChange = {id: domChangeID(), state: view.state}
  view.props.onChange(view.startDOMChange(view.inDOMChange.id))
  scheduleUpdateFromDOM(view)
}

function toClipboard(doc, from, to, dataTransfer) {
  let $from = doc.resolve(from), start = from
  for (let d = $from.depth; d > 0 && $from.end(d) == start; d--) start++
  let slice = doc.slice(start, to)
  if (slice.possibleParent.type != doc.type.schema.nodes.doc)
    slice = new Slice(Fragment.from(slice.possibleParent.copy(slice.content)), slice.openLeft + 1, slice.openRight + 1)
  let dom = slice.content.toDOM(), wrap = document.createElement("div")
  if (dom.firstChild && dom.firstChild.nodeType == 1)
    dom.firstChild.setAttribute("pm-open-left", slice.openLeft)
  wrap.appendChild(dom)
  dataTransfer.clearData()
  dataTransfer.setData("text/html", wrap.innerHTML)
  dataTransfer.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n\n"))
  return slice
}

let cachedCanUpdateClipboard = null

function canUpdateClipboard(dataTransfer) {
  if (cachedCanUpdateClipboard != null) return cachedCanUpdateClipboard
  dataTransfer.setData("text/html", "<hr>")
  return cachedCanUpdateClipboard = dataTransfer.getData("text/html") == "<hr>"
}

// : (DataTransfer, ?bool, ResolvedPos) → ?Slice
function fromClipboard(dataTransfer, plainText, $target) {
  let txt = dataTransfer.getData("text/plain")
  let html = dataTransfer.getData("text/html")
  if (!html && !txt) return null
  let dom
  if ((plainText || !html) && txt) {
    dom = document.createElement("div")
    txt.split(/(?:\r\n?|\n){2,}/).forEach(block => {
      let para = dom.appendChild(document.createElement("p"))
      block.split(/\r\n?|\n/).forEach((line, i) => {
        if (i) para.appendChild(document.createElement("br"))
        para.appendChild(document.createTextNode(line))
      })
    })
  } else {
    dom = readHTML(html)
  }
  let openLeft = null, m
  let foundLeft = dom.querySelector("[pm-open-left]")
  if (foundLeft && (m = /^\d+$/.exec(foundLeft.getAttribute("pm-open-left"))))
    openLeft = +m[0]
  let slice = parseDOMInContext($target, dom, {openLeft, preserveWhiteSpace: true})
  return slice
}

function insertRange($from, $to) {
  let from = $from.pos, to = $to.pos
  for (let d = $to.depth; d > 0 && $to.end(d) == to; d--) to++
  for (let d = $from.depth; d > 0 && $from.start(d) == from && $from.end(d) <= to; d--) from--
  return {from, to}
}

// Trick from jQuery -- some elements must be wrapped in other
// elements for innerHTML to work. I.e. if you do `div.innerHTML =
// "<td>..</td>"` the table cells are ignored.
const wrapMap = {thead: "table", colgroup: "table", col: "table colgroup",
                 tr: "table tbody", td: "table tbody tr", th: "table tbody tr"}
function readHTML(html) {
  let metas = /(\s*<meta [^>]*>)*/.exec(html)
  if (metas) html = html.slice(metas[0].length)
  let elt = document.createElement("div")
  let firstTag = /(?:<meta [^>]*>)*<([a-z][^>\s]+)/i.exec(html), wrap, depth = 0
  if (wrap = firstTag && wrapMap[firstTag[1].toLowerCase()]) {
    let nodes = wrap.split(" ")
    html = nodes.map(n => "<" + n + ">").join("") + html + nodes.map(n => "</" + n + ">").reverse().join("")
    depth = nodes.length
  }
  elt.innerHTML = html
  for (let i = 0; i < depth; i++) elt = elt.firstChild
  return elt
}

handlers.copy = handlers.cut = (view, e) => {
  let {from, to, empty} = view.state.selection, cut = e.type == "cut"
  if (empty) return
  if (!e.clipboardData || !canUpdateClipboard(e.clipboardData)) {
    if (cut && browser.ie && browser.ie_version <= 11) scheduleUpdateFromDOM(view)
    return
  }
  toClipboard(view.state.doc, from, to, e.clipboardData)
  e.preventDefault()
  if (cut) view.props.onChange(view.state.tr.delete(from, to).applyAndScroll())
}

handlers.paste = (view, e) => {
  if (!view.hasFocus()) return
  if (!e.clipboardData) {
    if (browser.ie && browser.ie_version <= 11) scheduleUpdateFromDOM(view)
    return
  }
  let range = insertRange(view.state.selection.$from, view.state.selection.$to)
  let slice = fromClipboard(e.clipboardData, view.shiftKey, view.state.doc.resolve(range.from))
  if (slice) {
    e.preventDefault()
    view.someProp("transformPasted", f => { slice = f(slice) })
    view.props.onChange(view.state.tr.replace(range.from, range.to, slice).applyAndScroll())
  }
}

class Dragging {
  constructor(slice, from, to, move) {
    this.slice = slice
    this.from = from
    this.to = to
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

  let {from, to, empty} = view.state.selection, dragging
  let pos = empty ? null : view.posAtCoords(eventCoords(e))
  if (pos != null && pos >= from && pos <= to) {
    dragging = {from, to}
  } else if (mouseDown && mouseDown.mightDrag) {
    let pos = mouseDown.mightDrag.pos
    dragging = {from: pos, to: pos + mouseDown.mightDrag.node.nodeSize}
  }

  if (dragging) {
    let slice = toClipboard(view.state.doc, dragging.from, dragging.to, e.dataTransfer)
    view.dragging = new Dragging(slice, dragging.from, dragging.to, !e.ctrlKey)
  }
}

handlers.dragend = view => {
  removeDropTarget(view)
  window.setTimeout(() => view.dragging = null, 50)
}

handlers.dragover = handlers.dragenter = (view, e) => {
  e.preventDefault()

  let target = view.dropTarget
  if (!target)
    target = view.dropTarget = view.wrapper.appendChild(elt("div", {class: "ProseMirror-drop-target"}))

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
  let range = insertRange($mouse, $mouse)
  let slice = dragging && dragging.slice || fromClipboard(e.dataTransfer, view.state.doc.resolve(range.from), $mouse)
  if (!slice) return
  let insertPos = dropPos(slice, view.state.doc.resolve(range.from))

  e.preventDefault()
  let tr = view.state.tr
  if (dragging && dragging.move)
    tr.delete(dragging.from, dragging.to)
  view.someProp("transformPasted", f => { slice = f(slice) })
  let pos = tr.mapping.map(insertPos)
  tr.replace(pos, pos, slice)
  tr.setSelection(Selection.between(tr.doc.resolve(pos), tr.doc.resolve(tr.mapping.map(insertPos))))
  view.focus()
  view.props.onChange(tr.apply())
}

handlers.focus = view => {
  view.wrapper.classList.add("ProseMirror-focused")
  view.someProp("onFocus", f => { f(view) })
}

handlers.blur = view => {
  view.wrapper.classList.remove("ProseMirror-focused")
  view.someProp("onBlur", f => { f(view) })
}
