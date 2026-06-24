(function () {
  var VERSION = 1
  var platformOrigin = ''
  var info = null
  var readyCallbacks = []
  var queue = []

  function send(msg) {
    if (!platformOrigin) {
      queue.push(msg)
      return
    }
    window.parent.postMessage(msg, platformOrigin)
  }

  function flush() {
    var pending = queue.splice(0)
    for (var i = 0; i < pending.length; i++) send(pending[i])
  }

  window.addEventListener('message', function (event) {
    var data = event.data || {}
    if (!data || data.t !== 'blobcade:hello' || data.v !== VERSION) return
    if (platformOrigin && event.origin !== platformOrigin) return
    platformOrigin = event.origin
    info = {
      name: String(data.name || ''),
      device: String(data.device || ''),
      room: String(data.room || ''),
    }
    var callbacks = readyCallbacks.splice(0)
    for (var i = 0; i < callbacks.length; i++) {
      try { callbacks[i](info) } catch (err) { setTimeout(function () { throw err }, 0) }
    }
    flush()
  })

  window.Blobcade = {
    ready: function (cb) {
      if (typeof cb === 'function') {
        if (info) cb(info)
        else readyCallbacks.push(cb)
      }
      return info
    },
    awardBlobcash: function (n, reason) {
      var amount = Math.max(1, Math.min(10, Math.floor(Number(n) || 0)))
      send({ t: 'blobcade:awardBlobcash', v: VERSION, n: amount, reason: String(reason || '').slice(0, 80) })
    },
    submitScore: function (seconds) {
      var score = Number(seconds)
      if (!Number.isFinite(score) || score <= 0) return
      send({ t: 'blobcade:submitScore', v: VERSION, seconds: score })
    },
  }

  window.parent.postMessage({ t: 'blobcade:ready', v: VERSION }, '*')
})()
