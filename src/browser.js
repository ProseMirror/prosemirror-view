const result = module.exports = {}

if (typeof navigator != "undefined") {
  const ie_upto10 = /MSIE \d/.test(navigator.userAgent)
  const ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(navigator.userAgent)

  result.mac = /Mac/.test(navigator.platform)
  result.ie = ie_upto10 || !!ie_11up
  result.ie_version = ie_upto10 ? document.documentMode || 6 : ie_11up && +ie_11up[1]
  result.gecko = /gecko\/\d/i.test(navigator.userAgent)
  result.ios = /AppleWebKit/.test(navigator.userAgent) && /Mobile\/\w+/.test(navigator.userAgent)
}
