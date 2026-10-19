# After the first phone message

Read this once a message from the user's phone has arrived in the conversation.

- **Dismiss the QR code.** Close the `phone-qr` panel so it stops taking up the side panel:
  `invoke_canvas_action` on `phone-qr` with `evaluate_javascript` and `window.close();`. There is no
  close action, so confirm with `read_page` that the panel is gone. If it is still open, say so in
  one line and ask the user to close it with the **x** on its tab. Leave the link in chat and the
  canvas's **Open on phone** button alone: they show the same QR code whenever it is needed again.
  If the button is missing (the gateway started after the canvas opened), open the canvas again.
- **Add to Home Screen.** Offer it: the canvas walks them through **Add to Home Screen** for their
  phone and browser, and it then opens like an app. After icon changes, tell them to delete the
  existing home-screen app and add it again (**Share → Add to Home Screen**): iOS snapshots the icon
  when the app is added.
- **Notifications.** The canvas asks by itself the first time it opens on the phone, in the
  installed app or in a browser tab: the user just approves the system prompt. If none appears, the
  first tap in the app triggers it (iOS requires a tap, and some browsers only show a quiet
  indicator). The bell has a slash through it until they approve; tapping it opens **Turn on** to
  ask again. Where the browser can't send notifications (an iPhone tab), the slashed bell points to
  **Add to Home Screen** instead. Once approved, have them tap the bell, then **Send test**, and
  confirm it arrives. Pushes carry no content, only a short preview line from their computer. They
  cover each reply, a question or approval waiting on them, and errors; the chat shows an unread
  count and the installed app's icon shows the same number. Later notifications stay quiet while the
  app is open in front; the bell has a switch to change that, and quiet hours for this phone. A user
  who turned notifications off, or blocked them in system settings, sees a plain bell and is not
  asked again.

Done when the QR panel is closed and the user has been offered Add to Home Screen and notifications.
