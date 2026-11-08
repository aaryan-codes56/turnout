# Two-minute demo

**Before you start:** have a published event open for check-in, and two windows: a student at phone width, and a club owner. Open a test ticket on a second device so you can scan it.

**0:00, the problem.** "Campus clubs run registration on Google Forms and check people in from a spreadsheet at the door. Turnout replaces both."

**0:15, a club publishes an event.** As the owner, open the dashboard, choose New event, fill in the title and time, add a question such as Team name, then Publish. Paste the event link into a chat and show the preview card. "That card is generated per event."

**0:40, a student registers.** In the student window, open the link and register. Show the QR ticket under My tickets. "If 50 people go for the last 10 seats at the same moment, exactly 10 get in. One conditional SQL update decides that, and there's a test that proves it."

**1:00, the door.** Open the scanner on a phone and scan the ticket. Green screen with the name. Scan it again: yellow, with when and by whom. "One atomic update means two volunteers can't both let the same ticket through." Then show the search-by-name fallback.

**1:25, payments.** Open a paid event and pay with a Razorpay test card. "The browser, the webhook and a reconciliation job can all race to confirm this payment, and it's confirmed exactly once. If a payment lands after the seat was given away, it's refunded automatically rather than overselling."

**1:45, the proof.** Show the live counter on the dashboard, then `/impact`. "These come from SQL over real tables, and anything flagged as test data is left out."

**1:55, close.** Open `docs/decisions.md`. "Every non-obvious choice is written down here: what we picked, why, and what we rejected."
