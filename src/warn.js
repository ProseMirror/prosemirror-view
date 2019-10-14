let checkedCSS = false

export let checkProsemirrorCSSLoaded = () => {
  if (!checkedCSS) {
    checkedCSS = true
    setTimeout(() => {
      let div = document.createElement('div')
      div.className = 'ProseMirror'
      document.body.appendChild(div)
      if (getComputedStyle(div).whiteSpace !== 'pre-wrap')
        console.warn("style/prosemirror.css has not been loaded. ProseMirror may behave incorrectly.")
      document.body.removeChild(div)
    }, 1000)
  }
}

export let checkProsemirrorCSSLoadedOnFocus = view => {
  if (!checkedCSS) {
    let onFirstFocus = () => {
      checkProsemirrorCSSLoaded()
      view.dom.removeEventListener('focus', onFirstFocus)
    }
    view.dom.addEventListener('focus', onFirstFocus)
  }
}