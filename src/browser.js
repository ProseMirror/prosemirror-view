const result = {}
export default result

if (typeof navigator != "undefined") {
  const ie_edge = /Edge\/(\d+)/.exec(navigator.userAgent)
  const ie_upto10 = /MSIE \d/.test(navigator.userAgent)
  const ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent)

  result.mac = /Mac/.test(navigator.platform)
  let ie = result.ie = !!(ie_upto10 || ie_11up || ie_edge)
  result.ie_version = ie_upto10 ? document.documentMode || 6 : ie_11up ? +ie_11up[1] : ie_edge ? +ie_edge[1] : null
  result.gecko = !ie && /gecko\/\d/i.test(navigator.userAgent)
  result.chrome = !ie && /Chrome\//.test(navigator.userAgent)
  result.ios = !ie && /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent)
  result.webkit = !ie && 'WebkitAppearance' in document.documentElement.style
}
