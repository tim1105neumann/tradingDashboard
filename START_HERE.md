# Starting the Trading Dashboard on Your Computer 🚀

This is a step-by-step guide to run the dashboard on your own laptop. No coding
knowledge needed — just follow along and copy-paste the commands.

"Running on localhost" simply means the app runs on **your own computer**, and you
open it in your web browser like any normal website. Nothing gets published online.

---

## Step 1: Open the project folder in the Terminal

In the Terminal, type `cd ` (the letters c and d, then a space), then **drag the
project folder into the Terminal window** and press Enter. It will look something
like this:

```
cd /Users/yourname/Downloads/tradingDashboard
```

That command means "go into the project folder."

---

## Step 2: Start the dashboard

Copy-paste this and press Enter:

```
npm start
```

After a moment you'll see a message like:

```
Trading dashboard running at http://localhost:4000
```

That means it's working! ✅

---

## Step 3: Open it in your browser

Open Chrome, Safari, or any browser and go to:

**http://localhost:4000**

The dashboard should appear. 🎉

---

## When you're done

- To **stop** the app, click back on the Terminal window and press `Ctrl + C`
  (hold the Control key and press C). It's fine to just close the Terminal too.

---

## If something goes wrong 🛠️

- **The page won't open / "can't connect"** → Make sure the Terminal still shows the
  "running at http://localhost:4000" message. If it stopped or showed an error,
  run `npm start` again.
- **"port 4000 is already in use"** → The app is probably already running in another
  Terminal window, or something else is using that port. Close other Terminal
  windows and try again.
- **Still stuck?** Take a screenshot of the Terminal and send it over. 📸

Your data is stored on your own computer in a `data` folder inside the project — it
stays private and stays put between restarts.
