# W2: new wording, for Ikenna's review

Every line below is **new** in W2. The brief asked for the app's own "Unavailable" copy where both
platforms have the state. That copy has never been available in this repo, and the app's source
can't be seen from here (CLAUDE.md), so these lines were written fresh in the house voice.

Where the copy lives: every line is in one of three files, so a change is made in one place.
- The failure state is in `app/lib/unavailableCopy.js`.
- The 404 is in `app/components/NotFoundPage.js` and `app/bookstore/not-found.js`.
- The offline page is in `public/sw.js`, in the `offlineResponse` function.

## The failure state: a read that failed or timed out

| Part | Words |
|---|---|
| Eyebrow | CAN'T REACH THE ISLAND |
| Button | Try again · *while working:* Trying… |
| **Offline** title | You're offline |
| Offline body | Check your connection, then try again. Anything you saved for offline reading is still in My Library. |
| **Slow** title | The island is slow to answer |
| Slow body | Nothing has come back yet. It's usually the connection, so try again in a moment. |
| **Our side** title | This part didn't load |
| Our side body | Something went wrong on our side, not yours. Try again in a moment. |

When a surface names itself, the heading becomes "We couldn't reach …" and the kind's title runs into the body.

| Surface | Heading | Extra |
|---|---|---|
| Home | We couldn't reach the stories. | |
| Home, Top 10 | We couldn't reach the Top 10. | (compact) |
| Search | We couldn't reach the index. | |
| Category shelves | We couldn't reach the Short Stories shelf. (Poetry, Flash Fiction, Inspiring Stories; News: "the news shelf") | |
| The Series | We couldn't reach The Series. / this series. / this instalment. | |
| Book Store | We couldn't reach the Book Store. / this book. | |
| Square | We couldn't reach the Square. | |
| My Library › Books | We couldn't reach your books. | They're still yours. |
| Profile | We couldn't reach your profile. | |
| Another reader | We couldn't reach this reader's profile. | |

## Empty shelves: a real, successful, empty answer

| Where | Words |
|---|---|
| Category shelves | Nothing on this shelf yet. |
| Counts | "12 stories", "1 poem", "9 articles": the nouns are now per shelf. Poetry used to say "stories". |

## 404

| | Site | Book Store |
|---|---|---|
| Eyebrow | NOT ON THE ISLAND | THE BOOK STORE |
| Title | There's nothing at this address | This book isn't on the shelf |
| Body | The link may be mistyped, or the page may have moved. Everything on the island starts from the library. | It may have been withdrawn, or the link may be mistyped. |
| Buttons | GO TO THE LIBRARY · SEARCH | BACK TO THE BOOK STORE · SEARCH |

## Another reader not found (/user)

**There's no reader by that name.** They may have changed their handle, or left the island. You can look for them in Search. **SEARCH**

## The offline page (service worker)

The existing "No signal" page is unchanged except for one new button, **TRY AGAIN**, which sits beside GO TO MY LIBRARY.
