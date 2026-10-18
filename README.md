# Copilot Canvas

Your Copilot conversation in three columns, on your computer and on your phone. Answer Copilot's
questions and approvals from anywhere, and ask Copilot to add panels or change how the canvas looks.

<br>

<p align="center">
  <a href="https://github.com/copilot/app/launch?open=ghapp%3A%2F%2Fsession%2Fnew%3Frepo%3Dms-jb%252Fcopilot-canvas%26mode%3Dinteractive%26prompt%3DSet%2520up%2520Copilot%2520Canvas%2520for%2520me%2520by%2520following%2520https%253A%252F%252Fgithub.com%252Fms-jb%252Fcopilot-canvas%252Fblob%252Fmain%252FSETUP.md"><img src="https://img.shields.io/badge/Install_in_GitHub_Copilot-339933?style=for-the-badge&logo=githubcopilot&logoColor=white" alt="Install in GitHub Copilot" height="56"></a>
</p>

<p align="center">
  <b>Copilot does the setup. You don't write code.</b><br>
  <sub>Opens the GitHub Copilot app (or offers to install it first). Copilot asks before it
  installs software, publishes anything or turns on phone access.</sub>
</p>

<p align="center">
  <sub>Using a GHE.com account? <a href="https://github.com/copilot/app/launch?open=ghapp%3A%2F%2Fgithub.com%2Fms-jb%2Fcopilot-canvas">Open the repository in the app</a> instead, then:</sub>
</p>

1. In the repository, start a new session.
2. Paste: _"Set up Copilot Canvas for me by following SETUP.md"_

<br>

<table>
  <tr>
    <td width="72%"><img src="docs/screenshots/desktop.png" alt="Copilot Canvas on desktop"></td>
    <td width="28%"><img src="docs/screenshots/phone.png" alt="Copilot Canvas on a phone"></td>
  </tr>
</table>

<details>
<summary>Dark theme</summary>

![Copilot Canvas on desktop, dark theme](docs/screenshots/desktop-dark.png)

</details>

## What you need

- A GitHub account with any Copilot plan. [Copilot Free](https://github.com/features/copilot/plans)
  works, but its monthly limits can run out during setup. On Copilot Business or Enterprise, your
  organization must leave the GitHub Copilot app policy on (it is on by default).
- The [GitHub Copilot app](https://docs.github.com/copilot/concepts/copilot-surfaces/github-copilot-app)
  on Windows, macOS or Linux.
- For the phone: nothing extra. You sign in to the private link with your GitHub account. Setup
  installs the other tools it needs (Node.js, the dev tunnel CLI) after it asks you.

## What you get

- Your Copilot conversation in the center, with timestamps and formatting.
- A status line above the box you type in, showing what Copilot is doing.
- Permission requests, questions and plan approvals answered right in the canvas.
- Your own panels on the right, starting with a few ideas you can tap.
- Your recent sessions in the left rail, so you can jump back into one.

## Change it

Ask Copilot in any chat, or tap one of the ideas in the canvas's empty right-hand side. Some ideas:

- _"Add a panel to my canvas that shows my open pull requests."_
- _"Add a Notes view to my canvas's sidebar where I can keep a scratchpad."_
- _"Rename my canvas assistant to Atlas and use a teal accent."_
- _"Add a checklist for today to my canvas that I can tick off."_

Copilot changes your copy of the canvas, rebuilds it, and the canvas switches to the new build by
itself. Then ask for the next thing.

## Your copy

Setup makes your own **private** repository from this template on your GitHub account (or, if you
prefer, a local folder only). It starts with fresh history and has no link back to this
repository. Your changes stay in your repository.

## Open on phone

Setup gives you a link and a QR code for your phone. Scan it, sign in with your GitHub account, and
send a message. The canvas then shows you how to add it to your home screen so it opens like an app.
If you change the app's icon later, remove the home-screen app and add it again to see the new one.

## Safety

Nothing is approved automatically: every permission, answer and plan approval is an explicit tap
from you. Only you can answer, both on your computer and on your phone: your copy runs on your own
computer, and only your account can open the phone link.

## License

Released under the [MIT License](LICENSE).
