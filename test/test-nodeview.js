const {doc, p, br, blockquote} = require("prosemirror-test-builder")
const {Plugin} = require("prosemirror-state")
const {tempEditor} = require("./view")
const {DecorationSet, Decoration} = require("..")
const ist = require("ist")

describe("nodeViews prop", () => {
  it("can replace a node's representation", () => {
    let view = tempEditor({doc: doc(p("foo", br)),
                           nodeViews: {hard_break() { return {dom: document.createElement("var")}}}})
    ist(view.dom.querySelector("var"))
  })

  it("can override drawing of a node's content", () => {
    let view = tempEditor({
      doc: doc(p("foo")),
      nodeViews: {paragraph(node) {
        let dom = document.createElement("p")
        dom.textContent = node.textContent.toUpperCase()
        return {dom}
      }}
    })
    ist(view.dom.querySelector("p").textContent, "FOO")
    view.dispatch(view.state.tr.insertText("a"))
    ist(view.dom.querySelector("p").textContent, "AFOO")
  })

  it("can register its own update method", () => {
    let view = tempEditor({
      doc: doc(p("foo")),
      nodeViews: {paragraph(node) {
        let dom = document.createElement("p")
        dom.textContent = node.textContent.toUpperCase()
        return {dom, update(node) { dom.textContent = node.textContent.toUpperCase(); return true }}
      }}
    })
    let para = view.dom.querySelector("p")
    view.dispatch(view.state.tr.insertText("a"))
    ist(view.dom.querySelector("p"), para)
    ist(para.textContent, "AFOO")
  })

  it("allows decoration updates for node views with an update method", () => {
    let view = tempEditor({
      doc: doc(p("foo")),
      nodeViews: {paragraph(node) {
        let dom = document.createElement("p")
        return {dom, contentDOM: dom, update(node_) { return node.sameMarkup(node_) }}
      }}
    })
    view.setProps({
      decorations(state) {
        return DecorationSet.create(state.doc, [
          Decoration.inline(2, 3, {someattr: "ok"}),
          Decoration.node(0, 5, {otherattr: "ok"})
        ])
      }
    })
    ist(view.dom.querySelector("[someattr]"))
    ist(view.dom.querySelector("[otherattr]"))
  })

  it("can provide a contentDOM property", () => {
    let view = tempEditor({
      doc: doc(p("foo")),
      nodeViews: {paragraph() {
        let dom = document.createElement("p")
        return {dom, contentDOM: dom}
      }}
    })
    let para = view.dom.querySelector("p")
    view.dispatch(view.state.tr.insertText("a"))
    ist(view.dom.querySelector("p"), para)
    ist(para.textContent, "afoo")
  })

  it("has its destroy method called", () => {
    let destroyed = false, view = tempEditor({
      doc: doc(p("foo", br)),
      nodeViews: {hard_break() { return {destroy: () => destroyed = true}}}
    })
    ist(!destroyed)
    view.dispatch(view.state.tr.delete(3, 5))
    ist(destroyed)
  })

  it("can query its own position", () => {
    let get, view = tempEditor({
      doc: doc(blockquote(p("abc"), p("foo", br))),
      nodeViews: {hard_break(_n, _v, getPos) {
        ist(getPos(), 10)
        get = getPos
        return {}
      }}
    })
    ist(get(), 10)
    view.dispatch(view.state.tr.insertText("a"))
    ist(get(), 11)
  })

  it("has access to outer decorations", () => {
    let plugin = new Plugin({
      state: {
        init() { return null },
        apply(tr, prev) { return tr.getMeta("setDeco") || prev }
      },
      props: {
        decorations(state) {
          let deco = this.getState(state)
          return deco && DecorationSet.create(state.doc, [Decoration.inline(0, state.doc.content.size, null, {name: deco})])
        }
      }
    })
    let view = tempEditor({
      doc: doc(p("foo", br)),
      plugins: [plugin],
      nodeViews: {hard_break(_n, _v, _p, deco) {
        let dom = document.createElement("var")
        function update(deco) {
          dom.textContent = deco.length ? deco[0].spec.name : "[]"
        }
        update(deco)
        return {dom, update(_, deco) { update(deco); return true }}
      }}
    })
    ist(view.dom.querySelector("var").textContent, "[]")
    view.dispatch(view.state.tr.setMeta("setDeco", "foo"))
    ist(view.dom.querySelector("var").textContent, "foo")
    view.dispatch(view.state.tr.setMeta("setDeco", "bar"))
    ist(view.dom.querySelector("var").textContent, "bar")
  })

  it("provides access to inner decorations that cover its range in the constructor", () => {
    let innerDecos = []
    const decos = [
      Decoration.inline(2, 3, {someattr: "ok"}),
      Decoration.node(0, 5, {otherattr: "ok"})
    ]
    const decoPlugin = new Plugin({
      state: {
        init() { return null },
        apply(tr, prev) { return tr.getMeta("setDeco") || prev }
      },
      props: {
        decorations(state) {
          return DecorationSet.create(state.doc, decos.slice())
        }
      }
    })
    tempEditor({
      doc: doc(p("foo")),
      plugins: [decoPlugin],
      nodeViews: {paragraph(node, _, __, ___, innerDecoSet) {
        let dom = document.createElement("p")
        innerDecos = innerDecoSet.find()
        return {dom, contentDOM: dom, update(node_) {
          return node.sameMarkup(node_)
        }}
      }}
    })

    ist(innerDecos.length, 1)
    ist(innerDecos[0].from, 1)
    ist(innerDecos[0].to, 2)
  })

  it("provides access to inner decorations that cover its range in the update method", () => {
    let innerDecos = []
    let view = tempEditor({
      doc: doc(p("foo")),
      nodeViews: {paragraph(node) {
        let dom = document.createElement("p")
        return {dom, contentDOM: dom, update(node_, _, innerDecoSet) {
          innerDecos = innerDecoSet.find()
          return node.sameMarkup(node_)
        }}
      }}
    })

    const decos = [
      Decoration.inline(2, 3, {someattr: "ok"}),
      Decoration.node(0, 5, {otherattr: "ok"})
    ]
    view.setProps({
      decorations(state) {
        return DecorationSet.create(state.doc, decos.slice())
      }
    })

    ist(innerDecos.length, 1)
    ist(innerDecos[0].from, 1)
    ist(innerDecos[0].to, 2)
  })
})
