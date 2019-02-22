import browser from "./browser"
import {domIndex} from "./dom"
import {hasFocusAndSelection, hasSelection, selectionToDOM} from "./selection"

const observeOptions = {childList: true, characterData: true, attributes: true, subtree: true, characterDataOldValue: true}
// IE11 has very broken mutation observers, so we also listen to DOMCharacterDataModified
const useCharData = browser.ie && browser.ie_version <= 11

class SelectionState {
  constructor() {
    this.anchorNode = this.anchorOffset = this.focusNode = this.focusOffset = null
  }

  set(sel) {
    this.anchorNode = sel.anchorNode; this.anchorOffset = sel.anchorOffset
    this.focusNode = sel.focusNode; this.focusOffset = sel.focusOffset
  }

  eq(sel) {
    return sel.anchorNode == this.anchorNode && sel.anchorOffset == this.anchorOffset &&
      sel.focusNode == this.focusNode && sel.focusOffset == this.focusOffset
  }
}

export class DOMObserver {
  constructor(view, handleDOMChange) {
    this.view = view
    this.handleDOMChange = handleDOMChange
    this.observer = window.MutationObserver &&
      new window.MutationObserver(mutations => this.flush(mutations))
    this.ignoreSelection = new SelectionState
    this.charDataQueue = []
    if (useCharData) {
      this.onCharData = e => {
        this.charDataQueue.push({target: e.target, type: "characterData", oldValue: e.prevValue})
        this.setTimeout(() => this.flush(), 20)
      }
    }
    this.onSelectionChange = this.onSelectionChange.bind(this)
  }

  start() {
    if (this.observer)
      this.observer.observe(this.view.dom, observeOptions)
    if (useCharData)
      this.view.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
    this.connectSelection()
  }

  stop() {
    if (this.observer) this.observer.disconnect()
    if (useCharData) this.view.dom.removeEventListener("DOMCharacterDataModified", this.onCharData)
    this.disconnectSelection()
  }

  connectSelection() {
    this.view.dom.ownerDocument.addEventListener("selectionchange", this.onSelectionChange)
  }

  disconnectSelection() {
    this.view.dom.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange)
  }

  onSelectionChange() {
    if (!hasFocusAndSelection(this.view)) return
    if (this.suppressSelectionUpdates) return selectionToDOM(this.view)
    this.flush()
  }

  ignoreCurSelection() {
    this.ignoreSelection.set(this.view.root.getSelection())
  }

  flush(mutations) {
    if (!mutations) mutations = this.observer.takeRecords()
    if (this.charDataQueue.length) {
      mutations = this.charDataQuery.concat(mutations)
      this.charDataQueue.length = 0
    }

    let sel = this.view.root.getSelection()
    let newSel = !this.ignoreSelection.eq(sel) && hasSelection(this.view)

    let from = -1, to = -1, typeOver = false
    if (this.view.editable) {
      for (let i = 0; i < mutations.length; i++) {
        let result = this.registerMutation(mutations[i])
        if (result) {
          from = from < 0 ? result.from : Math.min(result.from, from)
          to = to < 0 ? result.to : Math.max(result.to, to)
          if (result.typeOver) typeOver = true
        }
      }
    }
    if (from > -1 || newSel) {
      if (newSel) this.ignoreSelection.set(sel)
      this.handleDOMChange(from, to, typeOver)
    }
  }

  registerMutation(mut) {
    let desc = this.view.docView.nearestDesc(mut.target)
    if (mut.type == "attributes" &&
        (desc == this.view.docView || mut.attributeName == "contenteditable")) return null
    if (!desc || desc.ignoreMutation(mut)) return null

    if (mut.type == "childList") {
      let fromOffset = mut.previousSibling && mut.previousSibling.parentNode == mut.target
          ? domIndex(mut.previousSibling) + 1 : 0
      let from = desc.localPosFromDOM(mut.target, fromOffset, -1)
      let toOffset = mut.nextSibling && mut.nextSibling.parentNode == mut.target
          ? domIndex(mut.nextSibling) : mut.target.childNodes.length
      let to = desc.localPosFromDOM(mut.target, toOffset, 1)
      return {from, to}
    } else if (mut.type == "attributes") {
      return {from: desc.posAtStart - desc.border, to: desc.posAtEnd + desc.border}
    } else { // "characterData"
      return {
        from: desc.posAtStart,
        to: desc.posAtEnd,
        // An event was generated for a text change that didn't change
        // any text. Mark the dom change to fall back to assuming the
        // selection was typed over with an identical value if it can't
        // find another change.
        typeOver: mut.target.nodeValue == mut.oldValue
      }
    }
  }
}
