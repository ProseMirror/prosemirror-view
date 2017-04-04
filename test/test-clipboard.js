const ist = require("ist")
const {eq, doc, p, blockquote, ul, ol, li, hr, br} = require("prosemirror-test-builder")
const {NodeSelection, TextSelection} = require("prosemirror-state")
const {Slice} = require("prosemirror-model")
const {tempEditor} = require("./view")

const {serializeForClipboard, parseFromClipboard} = require("../dist/clipboard")

describe("Clipboard interface", () => {
  it("copies only the node for a node selection", () => {
    let d = doc(blockquote(p("a"), "<a>", hr), p("b"))
    let view = tempEditor({doc: d})
    let dom = serializeForClipboard(view, NodeSelection.create(d, d.tag.a).content())
    ist(dom.innerHTML, '<hr data-pm-context="none">')
    ist(parseFromClipboard(view, "", dom.innerHTML, false, d.resolve(1)), d.slice(d.tag.a, d.tag.a + 1), eq)
  })

  it("includes context for text selections", () => {
    let d = doc(blockquote(ul(li(p("fo<a>o"), p("b<b>ar")))))
    let view = tempEditor({doc: d})
    let slice = TextSelection.create(d, d.tag.a, d.tag.b).content(), dom = serializeForClipboard(view, slice)
    ist(dom.innerHTML, '<li data-pm-context="[&quot;blockquote&quot;,null,&quot;bullet_list&quot;,null]"><p>o</p><p>b</p></li>')
    let text = slice.content.textBetween(0, slice.content.size, "\n\n"), html = dom.innerHTML
    ist(parseFromClipboard(view, text, html, false, d.resolve(1)), d.slice(d.tag.a, d.tag.b, true), eq)
    ist(parseFromClipboard(view, text, html, true, d.resolve(1)), new Slice(doc(p("o"), p("b")).content, 1, 1), eq)
  })

  it("can read external HTML", () => {
    let view = tempEditor(), $p = view.state.doc.resolve(1)
    ist(parseFromClipboard(view, "", "<p>hello</p><hr>", false, $p), new Slice(doc(p("hello"), hr).content, 1, 0), eq)
    ist(parseFromClipboard(view, "", "<p>hello</p>bar", false, $p), new Slice(doc(p("hello"), p("bar")).content, 1, 1), eq)
  })

  it("will sanely clean up top-level nodes in HTML", () => {
    let view = tempEditor(), $p = view.state.doc.resolve(1)
    ist(parseFromClipboard(view, "", "<ul><li>foo</li></ul>bar<br>", false, $p),
        new Slice(doc(ul(li(p("foo"))), p("bar", br)).content, 3, 1), eq)
    ist(parseFromClipboard(view, "", "<ul><li>foo</li></ul>bar<br><p>x</p>", false, $p),
        new Slice(doc(ul(li(p("foo"))), p("bar", br), p("x")).content, 3, 1), eq)
    ist(parseFromClipboard(view, "", "<li>foo</li><li>bar</li><p>x</p>", false, $p),
        new Slice(doc(ol(li(p("foo")), li(p("bar"))), p("x")).content, 3, 1), eq)
  })
})
