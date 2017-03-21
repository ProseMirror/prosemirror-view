const ist = require("ist")
const {eq, doc, p, blockquote, ul, ol, li, hr, br} = require("prosemirror-test-builder")
const {NodeSelection, TextSelection} = require("prosemirror-state")
const {Slice} = require("prosemirror-model")
const {tempEditor} = require("./view")

const {toClipboard, fromClipboard} = require("../dist/clipboard")

function transfer(html, text) {
  return {
    data: {"text/html": html, "text/plain": text},
    clearData() { this.data = {} },
    setData(type, value) { this.data[type] = value },
    getData(type) { return this.data[type] },
  }
}

describe("Clipboard interface", () => {
  it("copies only the node for a node selection", () => {
    let d = doc(blockquote(p("a"), "<a>", hr), p("b"))
    let view = tempEditor({doc: d}), dt = transfer()
    toClipboard(view, NodeSelection.create(d, d.tag.a), dt)
    ist(dt.getData("text/html"), '<hr data-pm-node-selection="true">')
    ist(fromClipboard(view, dt, false, d.resolve(1)), d.slice(d.tag.a, d.tag.a + 1), eq)
  })

  it("includes context for text selections", () => {
    let d = doc(blockquote(ul(li(p("fo<a>o"), p("b<b>ar")))))
    let view = tempEditor({doc: d}), dt = transfer()
    toClipboard(view, TextSelection.create(d, d.tag.a, d.tag.b), dt)
    ist(dt.getData("text/html"), '<li data-pm-context="[&quot;blockquote&quot;,null,&quot;bullet_list&quot;,null]"><p>o</p><p>b</p></li>')
    ist(fromClipboard(view, dt, false, d.resolve(1)), d.slice(d.tag.a, d.tag.b, true), eq)
    ist(fromClipboard(view, dt, true, d.resolve(1)), new Slice(doc(p("o"), p("b")).content, 1, 1), eq)
  })

  it("can read external HTML", () => {
    let view = tempEditor(), $p = view.state.doc.resolve(1)
    ist(fromClipboard(view, transfer("<p>hello</p><hr>"), false, $p), new Slice(doc(p("hello"), hr).content, 1, 0), eq)
    ist(fromClipboard(view, transfer("<p>hello</p>bar"), false, $p), new Slice(doc(p("hello"), p("bar")).content, 1, 1), eq)
  })

  it("will sanely clean up top-level nodes in HTML", () => {
    let view = tempEditor(), $p = view.state.doc.resolve(1)
    ist(fromClipboard(view, transfer("<ul><li>foo</li></ul>bar<br>"), false, $p),
        new Slice(doc(ul(li(p("foo"))), p("bar", br)).content, 3, 1), eq)
    ist(fromClipboard(view, transfer("<ul><li>foo</li></ul>bar<br><p>x</p>"), false, $p),
        new Slice(doc(ul(li(p("foo"))), p("bar", br), p("x")).content, 3, 1), eq)
    ist(fromClipboard(view, transfer("<li>foo</li><li>bar</li><p>x</p>"), false, $p),
        new Slice(doc(ol(li(p("foo")), li(p("bar"))), p("x")).content, 3, 1), eq)
  })
})
