const {Slice, Fragment, DOMParser, DOMSerializer} = require("prosemirror-model")

function toClipboard(view, range, dataTransfer) {
  let doc = view.state.doc, slice = doc.slice(range.from, range.to)
  let parent = range.$from.node(range.$from.sharedDepth(range.to))
  if (parent.type != doc.type.schema.nodes.doc)
    slice = new Slice(Fragment.from(parent.copy(slice.content)), slice.openLeft + 1, slice.openRight + 1)

  let serializer = view.someProp("clipboardSerializer") || view.someProp("domSerializer") || DOMSerializer.fromSchema(view.state.schema)
  let dom = serializer.serializeFragment(slice.content), wrap = document.createElement("div")
  wrap.appendChild(dom)
  
  dataTransfer.clearData()
  dataTransfer.setData("text/html", wrap.innerHTML)
  dataTransfer.setData("text/plain", slice.content.textBetween(0, slice.content.size, "\n\n"))
  return slice
}
exports.toClipboard = toClipboard

let cachedCanUpdateClipboard = null
function canUpdateClipboard(dataTransfer) {
  if (cachedCanUpdateClipboard != null) return cachedCanUpdateClipboard
  dataTransfer.setData("text/html", "<hr>")
  return cachedCanUpdateClipboard = dataTransfer.getData("text/html") == "<hr>"
}
exports.canUpdateClipboard = canUpdateClipboard

// : (DataTransfer, ?bool, ResolvedPos) → ?Slice
function fromClipboard(view, dataTransfer, plainText, $context) {
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

  let parser = view.someProp("clipboardParser") || view.someProp("domParser") || DOMParser.fromSchema(view.state.schema)
  let slice = normalizeSiblings(parser.parseOpen(dom, {preserveWhitespace: true}), $context)
  return slice
}
exports.fromClipboard = fromClipboard

function normalizeSiblings(slice, $context) {
  if (slice.content.childCount < 2) return slice
  let firstNode
  slice.content.forEach(node => {
    if (!node.isText) { firstNode = node; return false }
  })
  if (!firstNode) return slice
  for (let d = $context.depth; d >= 0; d--) {
    let parent = $context.node(d), expr = parent.type.contentExpr, match
    if (match = expr.atType(parent.attrs, firstNode.type, firstNode.attrs, firstNode.marks)) {
      if (firstNode != slice.content.firstChild) match = expr.start(parent.attrs)
      let content = []
      slice.content.forEach(node => {
        let wrap = match.findWrappingFor(node)
        if (!wrap) { content = null; return false }
        for (let i = wrap.length - 1; i >= 0; i--)
          node = wrap[i].type.create(wrap[i].attrs, Fragment.from(node))
        content.push(node)
      })
      if (content) return console.log("::" + Slice.maxOpen(Fragment.from(content))), Slice.maxOpen(Fragment.from(content))
    }
  }
  return slice
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
