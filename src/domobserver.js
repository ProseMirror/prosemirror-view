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
      new window.MutationObserver(mutations => {
        // IE11 will sometimes (on backspacing out a single character
        // text node after a BR node) call the observer callback
        // before actually updating the DOM, which will cause
        // ProseMirror to miss the change (see #930)
        if (browser.ie && browser.ie_version <= 11 && mutations.some(
          m => m.type == "childList" && m.removedNodes.length == 1 && m.removedNodes[0].parentNode == m.target))
          setTimeout(() => this.flush(mutations), 10)
        else
          this.flush(mutations)
      })
    this.currentSelection = new SelectionState
    this.queue = []
    if (useCharData) {
      this.onCharData = e => {
        this.queue.push({target: e.target, type: "characterData", oldValue: e.prevValue})
        window.setTimeout(() => this.flush(), 20)
      }
    }
    this.onSelectionChange = this.onSelectionChange.bind(this)
    this.suppressingSelectionUpdates = false
  }

  start() {
    if (this.observer)
      this.observer.observe(this.view.dom, observeOptions)
    if (useCharData)
      this.view.dom.addEventListener("DOMCharacterDataModified", this.onCharData)
    this.connectSelection()
  }

  stop() {
    let take = this.observer.takeRecords()
    if (take.length) {
      for (let i = 0; i < take.length; i++) this.queue.push(take[i])
      window.setTimeout(() => this.flush(), 20)
    }
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

  suppressSelectionUpdates() {
    this.suppressingSelectionUpdates = true
    setTimeout(() => this.suppressingSelectionUpdates = false, 50)
  }

  onSelectionChange() {
    if (!hasFocusAndSelection(this.view)) return
    if (this.suppressingSelectionUpdates) return selectionToDOM(this.view)
    this.flush()
  }

  setCurSelection() {
    this.currentSelection.set(this.view.root.getSelection())
  }

  flush(mutations) {
    if (!this.view.docView) return
    if (!mutations) mutations = this.observer.takeRecords()
    if (this.queue.length) {
      mutations = this.queue.concat(mutations)
      this.queue.length = 0
    }

    let sel = this.view.root.getSelection()
    let newSel = !this.suppressingSelectionUpdates && !this.currentSelection.eq(sel) && hasSelection(this.view)

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
      if (from > -1) this.view.docView.markDirty(from, to)
      this.handleDOMChange(from, to, typeOver)
      if (this.view.docView.dirty) this.view.updateState(this.view.state)
      else if (!this.currentSelection.eq(sel)) selectionToDOM(this.view)
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
