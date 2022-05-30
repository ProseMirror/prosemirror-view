import ist from "ist"
import {eq, doc, p, strong, blockquote, ul, ol, li, hr, br} from "prosemirror-test-builder"
import {NodeSelection, TextSelection} from "prosemirror-state"
import {Slice, Fragment, Schema} from "prosemirror-model"
import {tempEditor} from "./view"

import {__serializeForClipboard as serializeForClipboard, __parseFromClipboard as parseFromClipboard} from "prosemirror-view"

describe("Clipboard interface", () => {
  it("copies only the node for a node selection", () => {
    let d = doc(blockquote(p("a"), "<a>", hr()), p("b"))
    let view = tempEditor({doc: d})
    let {dom} = serializeForClipboard(view, NodeSelection.create(d, (d as any).tag.a).content())
    ist(dom.innerHTML, '<hr data-pm-slice="0 0 []">')
    ist(parseFromClipboard(view, "", dom.innerHTML, false, d.resolve(1)), d.slice((d as any).tag.a, (d as any).tag.a + 1), eq)
  })

  it("includes context for text selections", () => {
    let d = doc(blockquote(ul(li(p("fo<a>o"), p("b<b>ar")))))
    let view = tempEditor({doc: d})
    let slice = TextSelection.create(d, (d as any).tag.a, (d as any).tag.b).content()
    let {dom, text} = serializeForClipboard(view, slice)
    ist(dom.innerHTML, '<li data-pm-slice="2 2 [&quot;blockquote&quot;,{},&quot;bullet_list&quot;,{}]"><p>o</p><p>b</p></li>')
    ist(parseFromClipboard(view, text, dom.innerHTML, false, d.resolve(1)), d.slice((d as any).tag.a, (d as any).tag.b, true), eq)
    ist(parseFromClipboard(view, text, dom.innerHTML, true, d.resolve(1)), new Slice(doc(p("o"), p("b")).content, 1, 1), eq)
  })

  it("preserves open nodes", () => {
    let d = doc(blockquote(blockquote(p("foo"))))
    let view = tempEditor({doc: d})
    let slice = new Slice(Fragment.from(d.firstChild), 1, 1)
    let html = serializeForClipboard(view, slice).dom.innerHTML
    let parsed = parseFromClipboard(view, "-", html, false, d.resolve(1))
    ist(parsed, slice, eq)
  })

  it("uses clipboardTextSerializer when given", () => {
    let view = tempEditor({doc: doc(p("hello")),
                           clipboardTextSerializer(_) { return "OK" }})
    let {text} = serializeForClipboard(view, view.state.doc.slice(1, 6))
    ist(text, "OK")
  })

  it("can read external HTML", () => {
    let view = tempEditor(), $p = view.state.doc.resolve(1)
    ist(parseFromClipboard(view, "", "<p>hello</p><hr>", false, $p), new Slice(doc(p("hello"), hr()).content, 1, 0), eq)
    ist(parseFromClipboard(view, "", "<p>hello</p>bar", false, $p), new Slice(doc(p("hello"), p("bar")).content, 1, 1), eq)
  })

  it("will sanely clean up top-level nodes in HTML", () => {
    let view = tempEditor(), $p = view.state.doc.resolve(1)
    ist(parseFromClipboard(view, "", "<ul><li>foo</li></ul>bar<br>baz", false, $p),
        new Slice(doc(ul(li(p("foo"))), p("bar", br(), "baz")).content, 3, 1), eq)
    ist(parseFromClipboard(view, "", "<ul><li>foo</li></ul>bar<br><p>x</p>", false, $p),
        new Slice(doc(ul(li(p("foo"))), p("bar", br()), p("x")).content, 3, 1), eq)
    ist(parseFromClipboard(view, "", "<li>foo</li><li>bar</li><p>x</p>", false, $p),
        new Slice(doc(ol(li(p("foo")), li(p("bar"))), p("x")).content, 3, 1), eq)
  })

  it("only drops trailing br nodes in block parents", () => {
    let view = tempEditor()
    ist(parseFromClipboard(view, "", "<p><strong>a<br></strong> b</p>", false, view.state.doc.resolve(1)),
        new Slice(doc(p(strong("a"), strong(br), " b")).content, 1, 1), eq)
  })

  it("will call transformPastedHTML", () => {
    let view = tempEditor({transformPastedHTML(_) { return "abc" }})
    ist(parseFromClipboard(view, "", "def", false, view.state.doc.resolve(1)),
        new Slice(p("abc").content, 0, 0), eq)
  })

  it("will call transformPastedText", () => {
    let view = tempEditor({transformPastedText(_) { return "abc" }})
    ist(parseFromClipboard(view, "def", null, false, view.state.doc.resolve(1)),
        new Slice(doc(p("abc")).content, 1, 1), eq)
  })

  it("allows text parsing to be overridden with clipboardTextParser", () => {
    let view = tempEditor({clipboardTextParser(text) { return doc(p(text.toUpperCase())).slice(1, text.length + 1) }})
    ist(parseFromClipboard(view, "abc", null, false, view.state.doc.resolve(1)),
        new Slice(p("ABC").content, 0, 0), eq)
  })

  it("preserves attributes", () => {
    let d = doc(ol({order: 3}, li(p("f<a>o<b>o"))))
    let view = tempEditor({doc: d})
    let {dom, text} = serializeForClipboard(view, TextSelection.create(d, (d as any).tag.a, (d as any).tag.b).content())
    ist(parseFromClipboard(view, text, dom.innerHTML, false, d.resolve(1)),
        d.slice((d as any).tag.a, (d as any).tag.b, true), eq)
  })

  function tableSchema() {
    return new Schema({
      nodes: {
        td: {content: "text*", toDOM: () => ["td", 0], parseDOM: [{tag: "td"}]},
        tr: {content: "td+", toDOM: () => ["tr", 0], parseDOM: [{tag: "tr"}]},
        table: {content: "tr+", toDOM: () => ["table", ["tbody", 0]], parseDOM: [{tag: "table"}]},
        doc: {content: "table+"},
        text: {}
      }
    })
  }

  it("adds necessary wrappers for parsing", () => {
    let s = tableSchema()
    let doc = s.node("doc", null, [s.node("table", null, [s.node("tr", null, [
      s.node("td", null, [s.text("A")]),
      s.node("td", null, [s.text("B")])
    ])])])
    let view = tempEditor({doc})
    let slice = doc.slice(3, 4, true)
    let html = serializeForClipboard(view, slice).dom.innerHTML
    ist(/<table/.test(html))
    ist(parseFromClipboard(view, "", html, false, doc.resolve(3)), slice, eq)
  })
})
