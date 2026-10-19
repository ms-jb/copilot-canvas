# Copilot Companion

Your Copilot conversation in three columns, on your computer and on your phone. Answer Copilot's
questions and approvals from anywhere, and ask Copilot to add panels or change how the companion looks.

<p align="center">
  <b>Using a GitHub Enterprise account? Do this first.</b><br>
  <a href="https://github.com/copilot/app/launch?open=ghapp%3A%2F%2Fgithub.com%2Fms-jb%2Fcopilot-companion"><img src="https://img.shields.io/badge/Add_the_project-6e7781?style=for-the-badge&logo=githubcopilot&logoColor=white" alt="Add the project" height="40"></a><br>
  <sub>Adds this project to the GitHub Copilot app, or offers to install the app first. Then click Install below.</sub>
</p>

<p align="center">
  <b>Everyone else: one click.</b><br>
  <a href="https://github.com/copilot/app/launch?open=ghapp%3A%2F%2Fsession%2Fnew%3Frepo%3Dms-jb%252Fcopilot-companion%26mode%3Dinteractive%26prompt%3DSet%2520up%2520Copilot%2520Companion%2520for%2520me%2520with%2520the%2520setup-copilot-companion%2520skill.%2520If%2520it%2520isn%2527t%2520available%252C%2520follow%2520https%253A%252F%252Fgithub.com%252Fms-jb%252Fcopilot-companion%252Fblob%252Fmain%252F.github%252Fskills%252Fsetup-copilot-companion%252FSKILL.md"><img src="https://img.shields.io/badge/Install-339933?style=for-the-badge&logo=githubcopilot&logoColor=white" alt="Install Copilot Companion" height="56"></a><br>
  <sub>Copilot adds the project and does the setup. It asks before it installs software, publishes anything or turns on phone access.</sub>
</p>

<p align="center">
  <sub>First time here? Either button opens the Copilot app, and if it isn't installed yet, the page it lands on has a button to install it. After installing, come back to this README and click the button again.</sub>
</p>

<details>
<summary>Prefer the terminal?</summary>

With the [GitHub Copilot CLI](https://docs.github.com/copilot/concepts/agents/about-copilot-cli)
signed in, run the same setup from any folder:

```sh
copilot -i "Set up Copilot Companion for me with the setup-copilot-companion skill. If it isn't available, follow https://github.com/ms-jb/copilot-companion/blob/main/.github/skills/setup-copilot-companion/SKILL.md"
```

The canvas needs the Copilot app, so the button above is the smoother path.

</details>

<br>

<table>
  <tr>
    <td width="72%"><img src="docs/screenshots/desktop.png" alt="Copilot Companion on desktop, light theme, with a queued message and the Plan mode chip"></td>
    <td width="28%"><img src="docs/screenshots/phone.png" alt="Copilot Companion on a phone, light theme"></td>
  </tr>
</table>

<details>
<summary>Dark theme</summary>

![Copilot Companion on desktop, dark theme](docs/screenshots/desktop-dark.png)

</details>

## What you need

- A GitHub account with any Copilot plan, including
  [Copilot Free](https://github.com/features/copilot/plans). On Copilot Business or Enterprise, your
  organization must leave the GitHub Copilot app policy on (it is on by default).

## What you get

- Your Copilot conversation in the center, with a status line showing what Copilot is doing.
- Permission requests, questions and plan approvals answered right in the canvas.
- Notifications on your phone for replies, questions and errors, an unread count on the chat and
  the app icon, and quiet hours.
- Dictation from the microphone button or Ctrl+Space, using your browser's own speech recognition
  (no account or key).
- Your own panels on the right, starting with a few ideas you can tap.
- Your recent sessions in the left rail, so you can jump back into one.

## Change it

Ask Copilot in any chat, or tap an idea in the canvas's empty right-hand side. For example:

- _"Add a panel to my canvas that shows my open pull requests."_
- _"Rename my canvas assistant to Atlas and use a teal accent."_

Copilot changes your copy, rebuilds it, and the canvas switches to the new build by itself.

## Your copy

Setup makes your own **private** repository from this template on your GitHub account (or a local
folder, if you prefer). It has fresh history and no link back to this repository.

## Get updates

New features and fixes land here. To bring them into your copy, paste this into any Copilot chat:

> Update my Copilot Companion from upstream with the update-copilot-companion skill.

Copilot checks what is new, tells you in plain language, and applies it on a separate branch with your
own changes kept (your name, icons and anything you built are never overwritten). It asks before it
merges, installs or restarts anything. Setup can also offer a weekly check that only tells you when
there is news.

## Open on phone

Setup gives you a link and a QR code. Scan it, sign in with your GitHub account, and send a
message. The canvas then shows you how to add it to your home screen. If you change the icon later,
remove the home-screen app and add it again.

## Safety

Nothing is approved automatically: every permission, answer and plan approval is an explicit tap
from you. Your copy runs on your own computer, and only your account can open the phone link.

## License

Released under the [MIT License](LICENSE).
