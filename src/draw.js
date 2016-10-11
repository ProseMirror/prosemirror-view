const {DOMSerializer} = require("prosemirror-model")

const browser = require("./browser")
const {childContainer} = require("./dompos")
const {removeOverlap} = require("./decoration")

const DIRTY_RESCAN = 1, DIRTY_REDRAW = 2
exports.DIRTY_RESCAN = DIRTY_RESCAN; exports.DIRTY_REDRAW = DIRTY_REDRAW

function getSerializer(view) {
  return view.someProp("domSerializer") || DOMSerializer.fromSchema(view.state.schema)
}

function draw(view, doc, decorations) {
  view.content.textContent = ""
  new Context(getSerializer(view), decorations).serializeContent(doc, view.content)
}
exports.draw = draw

function redraw(view, oldState, newState, oldDecorations, newDecorations) {
  let dirty = view.dirtyNodes
  if (dirty.get(oldState.doc) == DIRTY_REDRAW) return draw(view, newState.doc, newDecorations)

  let serializer = getSerializer(view)
  let onUnmountDOM = []
  view.someProp("onUnmountDOM", f => { onUnmountDOM.push(f) })

  function scan(dom, node, prev, oldDecorations, newDecorations) {
    let iPrev = 0, oPrev = 0, pChild = prev.firstChild
    let domPos = dom.firstChild
    while (domPos && (domPos.nodeType != 1 || domPos.hasAttribute("pm-ignore")))
      domPos = movePast(domPos, view, onUnmountDOM)

    let localDecorations = removeOverlap(newDecorations.locals(node))
    let decoIndex = applyDecorations(localDecorations, 0, 0, 0, dom, domPos, false)

    function syncDOM() {
      while (domPos) {
        let curOff = domPos.nodeType == 1 && domPos.getAttribute("pm-offset")
        if (!curOff || +curOff < oPrev)
          domPos = movePast(domPos, view, onUnmountDOM)
        else
          return +curOff == oPrev
      }
      return false
    }
    let oldLocalDecorations, offset = 0, child
    function sameLocalDeco() {
      return compareDecorations(oldLocalDecorations || (oldLocalDecorations = removeOverlap(oldDecorations.locals(prev))),
                                localDecorations, decoIndex,
                                oPrev, oPrev + pChild.nodeSize, offset, offset + child.nodeSize)
    }

    for (let iNode = 0; iNode < node.childCount; iNode++) {
      let matching, reuseDOM
      child = node.child(iNode)
      let found = pChild == child ? iPrev : findNodeIn(prev, iPrev + 1, child)
      if (found > -1) {
        matching = child
        while (iPrev != found) {
          oPrev += pChild.nodeSize
          pChild = prev.maybeChild(++iPrev)
        }
      }

      let childDeco = newDecorations.forChild(offset, child), prevChildDeco, matchedLocalDeco
      if (matching && !dirty.get(matching) &&
          childDeco.sameOutput(prevChildDeco = oldDecorations.forChild(offset, child)) &&
          (matchedLocalDeco = sameLocalDeco()) != null &&
          syncDOM()) {
        reuseDOM = true
        decoIndex = matchedLocalDeco
      } else if (pChild && !child.isText && child.sameMarkup(pChild) && dirty.get(pChild) != DIRTY_REDRAW &&
                 (matchedLocalDeco = sameLocalDeco()) != null && syncDOM()) {
        reuseDOM = true
        decoIndex = matchedLocalDeco
        if (!pChild.isLeaf)
          scan(childContainer(domPos), child, pChild, prevChildDeco || oldDecorations.forChild(oPrev, pChild), childDeco)
        domPos.setAttribute("pm-size", child.nodeSize)
      } else {
        let rendered = new Context(serializer, childDeco).serialize(child, offset)
        dom.insertBefore(rendered, domPos)
        reuseDOM = false
        decoIndex = applyDecorations(localDecorations, decoIndex, offset, offset + child.nodeSize, dom, rendered)
      }

      if (reuseDOM) {
        // Text nodes might be split into smaller segments
        if (child.isText) {
          for (let off = offset, end = off + child.nodeSize; off < end;) {
            if (offset != oPrev)
              domPos.setAttribute("pm-offset", off)
            off += +domPos.getAttribute("pm-size")
            domPos = domPos.nextSibling
          }
        } else {
          if (offset != oPrev)
            domPos.setAttribute("pm-offset", offset)
          domPos = domPos.nextSibling
        }
        oPrev += pChild.nodeSize
        pChild = prev.maybeChild(++iPrev)
        let end = offset + child.nodeSize
        decoIndex = applyDecorations(localDecorations, decoIndex, end, end, dom, domPos)
      }
      offset += child.nodeSize
    }

    while (domPos) domPos = movePast(domPos, view, onUnmountDOM)

    if (node.isTextblock) adjustTrailingHacks(serializer, dom, node)

    if (browser.ios) iosHacks(dom)
  }
  scan(view.content, newState.doc, oldState.doc, oldDecorations, newDecorations)
}
exports.redraw = redraw

class Context {
  constructor(serializer, decorations) {
    this.serializer = serializer
    this.decorations = decorations
  }

  onContent(parent, target) {
    target.setAttribute("pm-container", true)
    this.serializeContent(parent, target, this.decorations)
  }

  serialize(node, offset) {
    let dom = this.serializer.serializeNodeAndMarks(node, this)
    if (dom.nodeType != 1 || dom.contentEditable == "false") {
      let wrap = document.createElement(node.isInline ? "span" : "div")
      wrap.appendChild(dom)
      dom = wrap
    }
    dom.setAttribute("pm-size", node.nodeSize)
    dom.setAttribute("pm-offset", offset)
    if (node.isTextblock) adjustTrailingHacks(this.serializer, dom, node)
    return dom
  }

  serializeContent(node, target) {
    let decorations = this.decorations
    let locals = removeOverlap(decorations.locals(node))
    let i = applyDecorations(locals, 0, 0, 0, target, null, false)
    node.content.forEach((child, offset) => {
      this.decorations = decorations.forChild(offset, child)
      let dom = target.appendChild(this.serialize(child, offset))
      i = applyDecorations(locals, i, offset, offset + child.nodeSize, target, dom)
    })
  }
}

function applyDecorations(locals, i, from, to, domParent, domNode) {
  for (; i < locals.length; i++) {
    let span = locals[i]
    if (span.from > to || span.to > to) break
    if (span.from == to) {
      domNode = domNode && domNode.nextSibling
      from = to
    } else if (from < span.from) {
      domNode = splitText(domNode, span.from - from)
      from = span.from
    }
    let next = span.to > span.from && span.to < to && splitText(domNode, span.to - from)

    for (;;) {
      domNode = span.decoration.apply(domParent, domNode)
      if (i < locals.length - 1 && locals[i + 1].to == span.to) span = locals[++i]
      else break
    }
    if (next) {
      from = span.to
      domNode = next
    }
  }
  return i
}

function compareDecorations(old, cur, i, oldFrom, oldTo, curFrom, curTo) {
  let j = 0
  while (j < old.length && old[j].to <= oldFrom) j++
  for (;; i++, j++) {
    let oldEnd = j == old.length || old[j].from >= oldTo
    if (i == cur.length || cur[i].from >= curTo) return oldEnd ? i : null
    else if (oldEnd) return null
    let oldNext = old[j], curNext = cur[i]
    if (oldNext.decoration != curNext.decoration ||
        oldNext.from - oldFrom != curNext.from - curFrom ||
        oldNext.to - oldFrom != curNext.to - curFrom) return null
  }
}

function splitText(node, offset) {
  let inner = node
  while (inner.nodeType != 3) inner = inner.firstChild
  let newNode = document.createTextNode(inner.nodeValue.slice(offset))
  inner.nodeValue = inner.nodeValue.slice(0, offset)
  while (inner != node) {
    let parent = inner.parentNode, wrap = parent.cloneNode(false)
    wrap.appendChild(newNode)
    newNode = wrap
    inner = parent
  }
  node.parentNode.insertBefore(newNode, node.nextSibling)
  let size = +node.getAttribute("pm-size")
  newNode.setAttribute("pm-size", size - offset)
  node.setAttribute("pm-size", offset)
  newNode.setAttribute("pm-offset", +node.getAttribute("pm-offset") + offset)
  return newNode
}

function findNodeIn(parent, i, node) {
  for (; i < parent.childCount; i++) {
    let child = parent.child(i)
    if (child == node) return i
  }
  return -1
}

function movePast(dom, view, onUnmount) {
  let next = dom.nextSibling
  for (let i = 0; i < onUnmount.length; i++) onUnmount[i](view, dom)
  dom.parentNode.removeChild(dom)
  return next
}

function isBR(node, serializer) {
  if (!node.isLeaf || node.isText || !node.isInline) return false
  let ser = serializer.nodes[node.type.name](node)
  return Array.isArray(ser) ? ser[0] == "br" : ser && ser.nodeName == "BR"
}

function adjustTrailingHacks(serializer, dom, node) {
  let needs = node.content.size == 0 || isBR(node.lastChild, serializer) ||
      (node.type.spec.code && node.lastChild.isText && /\n$/.test(node.lastChild.text))
      ? "br" : !node.lastChild.isText && node.lastChild.isLeaf ? "text" : null
  let last = dom.lastChild
  let has = !last || last.nodeType != 1 || !last.hasAttribute("pm-ignore") ? null
      : last.nodeName == "BR" ? "br" : "text"
  if (needs != has) {
    if (has == "br") dom.removeChild(last)
    if (needs) {
      let add = document.createElement(needs == "br" ? "br" : "span")
      add.setAttribute("pm-ignore", needs == "br" ? "trailing-break" : "cursor-text")
      dom.appendChild(add)
    }
  }
}

function iosHacks(dom) {
  if (dom.nodeName == "UL" || dom.nodeName == "OL") {
    let oldCSS = dom.style.cssText
    dom.style.cssText = oldCSS + "; list-style: square !important"
    window.getComputedStyle(dom).listStyle
    dom.style.cssText = oldCSS
  }
}
