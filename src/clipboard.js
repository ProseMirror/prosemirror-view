const {Slice, Fragment, DOMParser, DOMSerializer} = require("prosemirror-model")

function serializeForClipboard(view, slice) {
  let context = [], {content, openStart, openEnd} = slice
  while (openStart > 1 && openEnd > 1 && content.childCount == 1 && content.firstChild.childCount == 1) {
    openStart--
    openEnd--
    let node = content.firstChild
    context.push(node.type.name, node.type.hasRequiredAttrs() ? node.attrs : null)
    content = node.content
  }

  let serializer = view.someProp("clipboardSerializer") || DOMSerializer.fromSchema(view.state.schema)
  let wrap = document.createElement("div")
  wrap.appendChild(serializer.serializeFragment(content))
  let child = wrap.firstChild.nodeType == 1 && wrap.firstChild
  if (child) {
    let singleNode = slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1 && !slice.content.firstChild.isText
    child.setAttribute("data-pm-context", singleNode ? "none" : JSON.stringify(context))
  }
  return wrap
}
exports.serializeForClipboard = serializeForClipboard

// : (EditorView, string, string, ?bool, ResolvedPos) → ?Slice
// Read a slice of content from the clipboard (or drop data).
function parseFromClipboard(view, text, html, plainText, $context) {
  let dom, inCode = $context.parent.type.spec.code
  if (!html && !text) return null
  if ((plainText || inCode || !html) && text) {
    view.someProp("transformPastedText", f => text = f(text))
    if (inCode) return new Slice(Fragment.from(view.state.schema.text(text)), 0, 0)
    dom = document.createElement("div")
    text.trim().split(/(?:\r\n?|\n)+/).forEach(block => {
      dom.appendChild(document.createElement("p")).textContent = block
    })
  } else {
    view.someProp("transformPastedHTML", f => html = f(html))
    dom = readHTML(html)
  }

  let parser = view.someProp("clipboardParser") || view.someProp("domParser") || DOMParser.fromSchema(view.state.schema)
  let slice = parser.parseSlice(dom, {preserveWhitespace: true, context: $context})
  slice = closeIsolatingStart(slice)
  let contextNode = dom.querySelector("[data-pm-context]"), context = contextNode && contextNode.getAttribute("data-pm-context")
  if (context == "none")
    slice = new Slice(slice.content, 0, 0)
  else if (context)
    slice = addContext(slice, context)
  else // HTML wasn't created by ProseMirror. Make sure top-level siblings are coherent
    slice = normalizeSiblings(slice, $context)
  view.someProp("transformPasted", f => { slice = f(slice) })
  return slice
}
exports.parseFromClipboard = parseFromClipboard

// Takes a slice parsed with parseSlice, which means there hasn't been
// any content-expression checking done on the top nodes, tries to
// find a parent node in the current context that might fit the nodes,
// and if successful, rebuilds the slice so that it fits into that parent.
//
// This addresses the problem that Transform.replace expects a
// coherent slice, and will fail to place a set of siblings that don't
// fit anywhere in the schema.
function normalizeSiblings(slice, $context) {
  if (slice.content.childCount < 2) return slice
  for (let d = $context.depth; d >= 0; d--) {
    let parent = $context.node(d)
    let match = parent.contentMatchAt($context.index(d))
    let lastWrap, result = []
    slice.content.forEach(node => {
      if (!result) return
      let wrap = match.findWrappingFor(node), inLast
      if (!wrap) return result = null
      if (inLast = result.length && lastWrap.length && addToSibling(wrap, lastWrap, node, result[result.length - 1], 0)) {
        result[result.length - 1] = inLast
      } else {
        if (result.length) result[result.length - 1] = closeRight(result[result.length - 1], lastWrap.length)
        let wrapped = withWrappers(node, wrap)
        result.push(wrapped)
        match = match.matchType(wrapped.type, wrapped.attrs)
        lastWrap = wrap
      }
    })
    if (result) return Slice.maxOpen(Fragment.from(result))
  }
  return slice
}

function withWrappers(node, wrap, from = 0) {
  for (let i = wrap.length - 1; i >= from; i--)
    node = wrap[i].type.create(wrap[i].attrs, Fragment.from(node))
  return node
}

// Used to group adjacent nodes wrapped in similar parents by
// normalizeSiblings into the same parent node
function addToSibling(wrap, lastWrap, node, sibling, depth) {
  if (depth < wrap.length && depth < lastWrap.length && wrap[depth].type == lastWrap[depth].type) {
    let inner = addToSibling(wrap, lastWrap, node, sibling.lastChild, depth + 1)
    if (inner) return sibling.copy(sibling.content.replaceChild(sibling.childCount - 1, inner))
    let match = sibling.contentMatchAt(sibling.childCount)
    if (depth == wrap.length - 1 ? match.matchNode(node) : match.matchType(wrap[depth + 1].type, wrap[depth + 1].attrs))
      return sibling.copy(sibling.content.append(Fragment.from(withWrappers(node, wrap, depth + 1))))
  }
}

function closeRight(node, depth) {
  if (depth == 0) return node
  let fragment = node.content.replaceChild(node.childCount - 1, closeRight(node.lastChild, depth - 1))
  let fill = node.contentMatchAt(node.childCount).fillBefore(Fragment.empty, true)
  return node.copy(fragment.append(fill))
}

// Trick from jQuery -- some elements must be wrapped in other
// elements for innerHTML to work. I.e. if you do `div.innerHTML =
// "<td>..</td>"` the table cells are ignored.
const wrapMap = {thead: "table", colgroup: "table", col: "table colgroup",
                 tr: "table tbody", td: "table tbody tr", th: "table tbody tr"}
let detachedDoc = null
function readHTML(html) {
  let metas = /(\s*<meta [^>]*>)*/.exec(html)
  if (metas) html = html.slice(metas[0].length)
  let doc = detachedDoc || (detachedDoc = document.implementation.createHTMLDocument("title"))
  let elt = doc.createElement("div")
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

function addContext(slice, context) {
  if (!slice.size) return slice
  let schema = slice.content.firstChild.type.schema, array
  try { array = JSON.parse(context) }
  catch(e) { return slice }
  let {content, openStart, openEnd} = slice
  for (let i = array.length - 2; i >= 0; i -= 2) {
    let type = schema.nodes[array[i]]
    if (!type || type.hasRequiredAttrs()) break
    content = Fragment.from(type.create(array[i + 1], content))
    openStart++; openEnd++
  }
  return new Slice(content, openStart, openEnd)
}

function closeIsolatingStart(slice) {
  let closeTo = 0, frag = slice.content
  for (let i = 1; i <= slice.openStart; i++) {
    let node = frag.firstChild
    if (node.type.spec.isolating) { closeTo = i; break }
    frag = node.content
  }

  if (closeTo == 0) return slice
  return new Slice(closeFragment(slice.content, closeTo, slice.openEnd), slice.openStart - closeTo, slice.openEnd)
}

function closeFragment(frag, n, openEnd) {
  if (n == 0) return frag
  let node = frag.firstChild
  let content = closeFragment(node.content, n - 1, openEnd - 1)
  let fill = node.contentMatchAt(0).fillBefore(node.content, openEnd <= 0)
  return frag.replaceChild(0, node.copy(fill.append(content)))
}
