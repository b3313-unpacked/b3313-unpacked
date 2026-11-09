# B3313 Unpacked

An interactive map, router and star checklist for **B3313 Unabandoned**.

- **Explore** the castle room by room. Every door, pipe, painting and drop is shown on a drawing of the room. Click one to go through it.
- **Star list:** all 471 stars and the four cap switches, with checkmarks saved in your browser. Search by name or course, or filter by color.
- **Room select:** every room as its drawing. Search by name, say how many ways out you can see, and add rooms or courses it connects to. The list narrows down until you recognize your room.
- **Route:** pick a room or course and get step-by-step directions, with each next exit highlighted.

This is a fan-made guide. It is not affiliated with Nintendo or with the developers of B3313.

---

## For the map maker: logging

Logging happens in Chrome or Edge, which can save straight into your copy of this repo.

1. Open the site with `?log` at the end of the address, for example `https://b3313-unpacked.github.io/?log`.
2. Press **Open my repo folder** at the top and choose your local copy of this repo. Allow Chrome to edit files there. From now on every edit saves into `data/` automatically, and pictures you load go into `assets/`.
3. Press **Log this room**, then for each room:
   - Load its black outline drawing and pick a fill color.
   - Click **Add exit** and click the drawing where each way out is. Describe it, pick its type, and set where it leads. Leave **Leads to** as *Not set yet* for exits you haven't been through.
   - Tick **Two-way** when going back through it brings you right back. The return door is created on the other side for you.
   - Use **Add stars from the star list** to place the stars that are in this room, and mark any cap switches that are here.
   - Press **Go through** to move on and keep logging.
4. Made a room by mistake? Delete it from the top of its **This room** card, or from its card in **Room select**.
5. Check the **Data check** tab. It lists everything unfinished: exits with no destination, return doors that still need placing, unplaced stars, drawings with gaps, and so on.
6. Commit and push. The live site updates a minute or two later.

The next time you open `?log`, Chrome may ask you to reconnect to the folder. Click the button at the top. If something goes wrong before an edit is saved, the site keeps a backup in your browser and offers to restore it.

### Drawings

Draw each room as a **black outline** on a white or see-through background, in any paint program. The site fills the inside with the room's fill color. The outline must be fully closed, or the fill leaks out. Multi-floor rooms can be several closed shapes in one drawing; add labels like "1st floor" in the editor.

### Exit pictures

You can drop pictures straight into `assets/art/` with File Explorer. While logging, the site checks the folder whenever you switch back to the browser, adds any new pictures to its list, and guesses each one's category from its file name: names containing *door*, *pipe*, *paint*, *trap*, or *dead*/*death*/*kill* go under those categories, and anything else goes under Other. If you delete a picture's file, it leaves the list too, and exits that used it switch to a plain icon. The list lives in `data/map.json`, so commit that file along with the pictures.

`assets/art/` has a stand-in picture for each exit type: `door.png`, `doubledoor.png`, `trapdoor.png`, `pipe.png`, `painting.png`, `hole.png`, `warp.png`, `exitcourse.png`, `deadly.png` and `other.png`. Save your own drawing over a stand-in with the same file name and every exit of that type switches over. To give one exit a different picture, pick or add it in that exit's editor.

### Exit types worth knowing

- **Deadly dead end:** a way in that gets you killed. Routes never use it. You can note the room you die in and where you respawn.
- **Sometimes leads somewhere else:** an exit with a usual destination plus other possible ones. Routes rely on the usual one, and only use the others when there's no other way.
- **Exit course:** the pause-menu exit from a course.

---

## How the data is stored

- `data/map.json` holds the rooms and courses (`places`), their exits, and the exit pictures (`art`, `typeArt`).
  - Every exit is written from the place you are standing in.
  - A two-way connection is two exits that name each other in `pair`.
  - `x` and `y` are positions on the room's drawing, from 0 to 1.
- `data/stars.json` holds the four cap switches and all 471 stars, one per line. A switch can be in several `places`; routes go to the nearest.
  Each star has its group (`course`) as shown in Parallel Launcher, its `color`, a `name`, the `place` it's been logged in, and its location in the save file (`save`). The `id` is that save location, so ids never change.
  - One star is listed under both Desert Maze and Sunken Castle in the Parallel Launcher layout. It is a single save spot: collecting either one marks both, and they count as one star.
- Your star checkmarks are not in this repo. They live in each visitor's browser, and the star list can back them up and restore them.

## Credits

- B3313 and B3313 Unabandoned belong to their developers.
- The star list was converted from the B3313 star layout for Parallel Launcher. Credit to its author.
- Super Mario 64 is a trademark of Nintendo.