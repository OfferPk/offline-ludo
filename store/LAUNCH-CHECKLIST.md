# Launch checklist: Crossfour on Google Play (new personal account)

## v1.3.0 update — Roman Urdu khulasa (naya kya hai)

- **Quick Ludo:** har player ki 2 gotiyan (4 nahi), wahi board. 6 se base se nikalna, ghar ke liye exact number, safe squares. Match bohot jaldi khatam (300 games mein average ~86 rolls). 1 v 1 aur computer.
- **Team Ludo, 2v2:** samne wale partners. Coral ke sath Saffron, Jade ke sath Cobalt. Team tab jeeti hai jab **dono** partners ki saari gotiyan ghar pohanch jayein. Partner ko capture nahi kar sakte. Pass & Play, ya aap + computer partner do computer ke khilaf.
- **Arrow Ludo:** amber ek-taraf teer. Teer par rukna ya us par se guzarna, dono mein goti ek khana aur aage clockwise chali jati hai. Ghar ki lane par teer nahi. Yahi cheez House rules se Classic mein bhi on ho sakti hai.
- **Friendly:** capture band. Sirf race. App phir bhi **13+** hai.
- **Polish:** chuni hui goti highlight, pichhli chaal ke khane roshan, jeet ki screen par moves aur waqt. Haptics dice aur capture par, Settings se band (default on). Do muft board: Midnight (dark) aur Classic Wood. Coins sirf cosmetic. Koi purchase / bet / entry fee nahi.
- **Ads wahi:** interstitial sirf match ke baad, 5 matches AUR 3 minute ke baad, cap, pehle session / launch / exit / back par kabhi nahi. Rewarded sirf tap par. Google TEST ad IDs. targetSdk 36. Poora offline.
- **Upload:** `offline-ludo-v1.3.0.aab` (version 1.3.0, **versionCode 4**), wahi upload key (SHA-256 `F1:C8:15:EA…`). **Asli AdMob IDs wala agla version v1.3.1 / versionCode 5 hoga** (pehle v1.2.1 / code 4 likha tha).

## v1.2.0 update — Roman Urdu khulasa (naya kya hai)

- **Naya teesra mode "Lucky Chaos Ludo"** (aap ka rakha hua naam). Classic/Star aur Mystery Tiles waise hi hain. Normal Ludo rules (Star style + house rules), saath mein qismat jise aap control kar sakte hain.
- **8 Lucky tiles:** 4 **?** Boost tiles (Shield, Jump +3, Double Roll, Extra Roll, Lucky 6, Safe Escape) aur 4 **!** Chaos tiles (Bomb, Swap, Zap, Freeze, Back 3, Wild Jump). Goti **bilkul exact** tile par ruke to wheel ghoomta hai. Istemal ke baad tile **2 round** aaraam karti hai (tile par bache hue rounds ka number dikhta hai).
- **4 Danger tiles "High Risk / High Reward"** (peeli-kaali dhaariyan, **!!**): 50/50 Boost ya Chaos wheel, aur nateeje zyada taqatwar (Jump +5, 2 extra rolls, Big Bomb, Back 5).
- **Lucky Streak** (aag ka nishaan ×1–×3): har spin par barhta hai, behtar nateeje ka chance; apni goti pitne par zero. **Revenge Charge:** goti pitne ke baad agle spin par **2 nateeje, aap ek chuno**.
- **Lucky Charge meter (5 dabbe):** spin aur capture se bharta hai. **5/5** par dice ke saath **MEGA** button: Mega Wheel (Rocket, Free Token, Royal Guard, Double Turn, Storm, Crown). Taqatwar magar game ka faisla nahin karta.
- **King goti (taaj):** jo goti 2 dushman gotiyan maare wo 3 baariyon tak King: +1 qadam aur Chaos se mehfooz. King ko maarne wale ka meter seedha 5/5.
- **Stored powers:** zyada se zyada 2, ek jaisi do nahin. Swap / Wild Jump / Revenge par **3 second** faisla; waqt khatam ho to best option khud chun liya jata hai (computer foran faisla karta hai).
- **Insaaf:** home lane wali goti ko kuch nahin hota, Bomb/Storm sirf 3 khane peeche (base nahin), 40+ khane wali goti par Zap sirf 6 peeche, safe squares/shield/King mehfooz. Peeche reh jane wale player ko thori (capped) madad.
- **1 v 1 aur 4 players, computer (Easy/Normal/Hard) ya Pass & Play.** Computer bhi powers, Mega Wheel aur King ka sahi istemal karta hai. Game mein **How to play** page aur `RULES.md` update.
- **Balance (1000 games har setting):** 1 v 1 mein Hard ne Easy ko 91.9% haraya (Star mode mein bhi 91.9%). 4 players mein akela Hard teen Easy ke khilaaf 77.0% jeeta (barabar hissa 25%). 1 v 1 game Star se ~15% chhota (148 vs 174 rolls). 50% par aage wala 1 v 1 mein 71.4% jeetta hai, yani skill ab bhi chalti hai.
- **Policy wahi:** koi entry fee / shart / bet / real money nahin; wheels sirf board badalte hain, coins nahin dete ya lete. Coins sirf cosmetic. Ads rules wahi (interstitial 5 matches + 3 minute ke baad, rewarded sirf tap par). Google TEST ad IDs abhi bhi lagi hain. targetSdk 36, poora offline.
- **Naam par note:** "Lucky Chaos Ludo" mein "Lucky Ludo" ke alfaaz hain jo Yalla Ludo ke ek mode ka naam bhi hai. Hamara design, art aur rules apne hain; listing mein hamesha poora naam likha hai. Agar Google ya koi aur aitraaz kare to mode ka naam ek chhote update mein badla ja sakta hai.
- **Upload:** `offline-ludo-v1.2.0.aab` (version 1.2.0, **versionCode 3**), wahi upload key (SHA-256 `F1:C8:15:EA:…:9C:47`). Pehle koi version upload nahin kiya to seedha v1.2.0 upload karo.
- **Store listing:** nayi short/full description, release notes aur 8 screenshots (pehli do Lucky Chaos ki) `listing-en.md` / `store/screenshots/` mein.
- **Real ad IDs wala version ab v1.2.1 (versionCode 4) hoga** (pehle v1.1.1 likha tha).

## v1.1.0 update — Roman Urdu khulasa (naya kya hai)

- **Har player ka dice uske apne corner mein:** aap ka dice neeche-baayen (bottom-left) aap ke avatar ke saath. Jis ki baari ho us ka corner chamakta hai. Turn timer (20 sec) Settings mein hai, default band.
- **Ludo Star / Yalla jaisa roll system (default "Star style"):** 6 aaye to foran dobara roll. Rolls chips ki shakal mein jama hote hain (jaise 6, 6, 3). Phir chip tap karo aur goti tap karo. Sirf ek chaal ho to khud chal jati hai. **Teen 6 lagatar = poori baari ke rolls zaya.** Goti maarne (capture) par aur goti ghar pohanchne par bonus roll. Base se sirf 6 par nikalti hai, ghar ke liye exact number, start aur star squares safe.
- **House rules (Settings):** "Classic" (har 6 pehle chalo phir roll) ya "Star style", safe squares, **capture ke baghair ghar mein entry nahin**, **blocks** (do gotiyan ek square par = rasta band), bonus rolls on/off. Poore rules `RULES.md` aur game ke **Rules** screen mein.
- **Naya mode "Mystery Tiles":** board par **?** (Boost wheel: Shield, Jump +3, Extra roll, Double die, Pick a number, Freeze) aur **!** (Chaos wheel: Back 3, Swap, Zap, Stuck, Jump +6, Calm) tiles. Goti tile par ruke to wheel ghoomta hai. 1 v 1 ya 4 players. **Koi coin entry fee / shart nahin** (Play policy ke mutabiq).
- **Undo dice roll:** roll ke baad ~2 second mein undo, har match mein 3 muft; us ke baad sirf player ke tap par optional rewarded ad se ek aur.
- **Computer:** Easy / Normal / Hard (Hard captures, safety, blocks aur events samajh kar khelta hai). Computer kabhi kabhi quick-chat / emoji bhejta hai; aap bhi bhej sakte hain (sirf isi phone par, online kuch nahin jata). Pass & Play 2–4 log.
- **Polish:** goti qadam ba qadam, capture effect, awazein, haptics, level/XP, stats, result screen par 1st–4th rank.
- **Ads rules wahi:** interstitial sirf **5 matches AUR 3 minute** ke baad, har 2 match mein zyada se zyada ek, 120 sec ka faasla, launch/exit/back par kabhi nahin, pehle session mein kabhi nahin. Google TEST ad IDs abhi bhi lagi hain.
- **Upload:** `offline-ludo-v1.1.0.aab` (version 1.1.0, **versionCode 2**), wahi purani upload key se sign hai (SHA-256 `F1:C8:15:EA:…:9C:47`), is liye Play Console isay qabool karega. Agar v1.0.0 abhi upload nahin kiya tha to seedha v1.1.0 upload karo.
- **Store listing update:** nayi description aur 7 nayi screenshots `listing-en.md` / `store/screenshots/` mein. Release notes bhi wahin hain.

## Roman Urdu mein khulasa (short summary)

1. **Play Console account banao:** play.google.com/console par "Yourself" (personal) chuno, **$25 ek dafa** fee do, aur apna **ID card / identity verify** karo. Verification mein kuch din lag sakte hain.
2. **App banao:** naam "Crossfour: Offline Ludo", Game, Free. Phir "App content" ke sawal `play-console-answers.md` se copy karo, aur store listing `listing-en.md` se. Tasveerein `store/` folder mein hain.
3. **Closed testing:** v1.3.0 wali **AAB** file (`offline-ludo-v1.3.0.aab`) closed testing track par upload karo. **Play App Signing** on rakho (Google-generated key).
4. **12 testers, 14 din:** kam az kam **12 log (behtar hai 15–20)** opt-in karein aur **lagatar 14 din** tak test mein rahein. Beech mein koi nikal gaya to ginti dobara ho sakti hai.
5. **Production ke liye apply karo:** 14 din ke baad Dashboard par "Apply for production" dabao aur sawalon ke jawab do.
6. **AdMob:** app banao, **Banner, Interstitial, Rewarded** teen ad units banao, **GDPR (UMP) message** publish karo. App Play par live hone ke baad AdMob mein Play se **link** karo.
7. **IDs mujhe bhejo:** AdMob **App ID** aur teeno **ad unit IDs** mujhe do. Main inhein `www/js/ads-config.js` aur `AndroidManifest.xml` mein laga kar naya version (v1.3.1) bana dunga. Wo version production mein jayega.
8. **Kabhi apne ads par khud click na karo.** Is se AdMob account band ho sakta hai.
9. **Target audience:** sirf **13–15, 16–17 aur 18+** tick karo (bachon wale age groups nahin). Data safety mein AdMob wale 4 data types bharo (details `play-console-answers.md` mein hain).
10. **Upload key ka backup:** `offline-ludo-key-backup.zip` (keystore + password file) ko kisi mehfooz jagah, jaise USB ya password manager, mein rakho. GitHub par kabhi mat daalna. Key gum ho jaye to Play Console se upload key reset karwani padegi.
11. **Game mein koi purchase nahin:** coins sirf match khatam karne se milte hain aur sirf cosmetic board/dice skins par lagte hain. Coins par koi shart (bet) nahin lagti aur cash-out nahin hota. Isliye Console mein "In-app purchases: No" aur "Financial features: None" chuno.

---

## What you need before you start

- A Google account (Gmail). Use the same one for Play Console and AdMob. It makes linking easy.
- A debit/credit card that works for international payments ($25).
- Your CNIC or passport, for identity verification. Your name must match the card and the Payments profile.
- An Android phone. Google may ask you to verify the account with the **Play Console mobile app** on a real Android device.
- A support email address. It is shown on the store page.
- 15–20 friends or family with Android phones and Gmail accounts (testers).
- The files in this `store/` folder.
- The app bundle: https://github.com/OfferPk/offline-ludo/releases/download/v1.3.0/offline-ludo-v1.3.0.aab

---

## Part A: Create your Play Console developer account

1. Go to https://play.google.com/console/signup
2. Choose **"Yourself"** (personal account). Do not choose "An organization" unless you have a registered company with a D-U-N-S number.
3. Enter your **developer name**. It is shown on Google Play under the app name, so choose it carefully (for example "OfferPk").
4. Create or choose a **Google Payments profile**. Use your real legal name and address.
5. Pay the **$25 one-time registration fee**.
6. Fill in the contact details: email and phone. Verify both with the codes Google sends you.
7. Answer the short questions about your Android experience and how many apps you plan to publish.
8. **Verify your identity.** Upload a photo of your CNIC or passport when asked. Wait for the approval email. It can take from a few hours to a few days.
9. If asked, install the **Google Play Console** app on your Android phone and sign in, to verify that you have a real device.
10. When the account shows as verified, continue.

---

## Part B: Create the app

1. In Play Console, click **Create app**.
2. **App name:** `Crossfour: Offline Ludo`
3. **Default language:** English (United States) – en-US
4. **App or game:** Game
5. **Free or paid:** Free
6. Tick the declarations (Developer Program Policies and US export laws) and click **Create app**.
7. Open **Dashboard → "Set up your app"** and finish every task:
   - **App content:** copy the answers from `store/play-console-answers.md` (privacy policy, ads, app access, content rating, target audience, data safety, advertising ID, news, government, financial, health).
   - **Store settings:** Category **Board**, tags, contact email, website.
   - **Main store listing:** copy the text from `store/listing-en.md`. Upload:
     - App icon: `store/icon-512.png`
     - Feature graphic: `store/feature-graphic-1024x500.png`
     - Phone screenshots: `store/screenshots/01.png` to `07.png` (in order)
8. Click **Save** on every page.

---

## Part C: Closed testing with Play App Signing and the v1.3.0 AAB

1. Download the AAB to your computer:
   https://github.com/OfferPk/offline-ludo/releases/download/v1.3.0/offline-ludo-v1.3.0.aab
2. Go to **Test and release → Testing → Closed testing**.
3. Open the default track (often called **"Closed testing – Alpha"**) and click **Manage track**. You can also create a new track.
4. **Countries/regions tab:** add the countries where your testers live (for example Pakistan). You can also add all countries.
5. **Testers tab:**
   - Choose **Email lists → Create email list**.
   - Name it "Testers" and add **15–20 Gmail addresses**. Add more than 12 in case someone drops out.
   - Add a **feedback email or URL** (your email is fine).
   - Click **Save**.
6. **Releases tab → Create new release.**
7. **Play App Signing:** when asked about the app signing key, keep **"Use a Google-generated key"** (the default) and accept. Google keeps the real signing key safe. The key in our GitHub Actions (the repository secrets) is now your **upload key**.
   - Keep a backup of the upload keystore file and its passwords in a safe place (the build box has `/workspace/keybackup/offline-ludo-key-backup.zip`). If you lose it, you can ask Google support to reset the upload key, but it takes time.
8. **Upload** `offline-ludo-v1.3.0.aab`. Play will read the package `com.offerpk.offlineludo`, version 1.3.0 (code 4). (If you already uploaded an earlier code, this is the next release on the same track.)
9. **Release name:** `1.3.0`. **Release notes** (en-US):
   ```
   New in 1.2: Lucky Chaos Ludo, a new mode with Boost and Chaos wheels, High Risk / High Reward Danger tiles, Lucky Streaks, Revenge Charges, a Lucky Charge meter with a Mega Wheel, crowned King tokens and stored powers. 1 v 1 or 4 players, vs computer or pass & play, with a How to play page. Computer players use every new feature. Still fully offline, no stakes or entry fees.
   ```
10. Click **Next**, fix any errors, then **Save**.
11. Go to **Publishing overview** and click **Send changes for review**. Review usually takes 1–7 days for a new app.
12. When the release is live, go back to **Closed testing → Testers** and copy the **opt-in link** ("Join on the web").
13. Send that link to all your testers. Each tester must:
    - Open the link while signed in with the **same Gmail** you added to the list.
    - Click **"Become a tester"**.
    - Install the app from the Google Play link on that page.
    - **Stay in the test.** They should not click "Leave the program".
    - Open and play the game a few times during the 14 days, and send you short feedback.

> Note: v1.3.0 still uses Google's **test ad IDs**, so testers will see "Test Ad" banners. That is fine and safe for testing. The real ad IDs go into v1.3.1 (see Part F).

---

## Part D: The 12 testers / 14 days rule

- This applies to **personal accounts created after 13 Nov 2023**.
- You need **at least 12 testers opted in** to your closed test.
- They must stay opted in **continuously for the last 14 days** before you apply.
- The count starts when testers **actually opt in**, not when you send the email.
- If someone opts out and joins again, their days start again from zero.
- If you drop below 12, add new testers quickly. The 14-day window must be unbroken.
- Check progress on the **Dashboard**. It shows how many testers are opted in and for how many days.
- Tip: invite 15–20 people. Keep a simple list with their name, Gmail, the date they joined, and their feedback. You will need this for the production questions.
- You can upload a newer build (for example v1.3.1 with real ads) to the **same closed track** during the test. Testers stay opted in.
- Official rule: https://support.google.com/googleplay/android-developer/answer/14151465

---

## Part E: Apply for production

1. After 14 full days with 12+ testers, go to **Dashboard**. Click **Apply for production**.
2. Answer the questions honestly and in detail. For example:
   - How you found testers (friends, family, colleagues).
   - What they tested (2, 3 and 4 player matches, all three computer levels, pass & play, each house rule on and off, captures, exact home entry, three 6s, undo vs computer, resume after closing, stats, skins, settings, ads).
   - What feedback you got and what you changed. Even small fixes count (for example, "added real ad IDs and turned off test mode in v1.3.1").
   - Why the app is ready (stable, no crashes, rules covered by automated tests including 1000 simulated computer-vs-computer matches that all finish, works offline, match saved automatically).
3. Submit. Google usually answers within about 7 days.
4. When approved: go to **Test and release → Production → Create new release**.
   - Upload the **newest AAB** (v1.3.1 with real ad IDs, see Part F), or promote the release from closed testing.
   - Choose countries/regions.
   - Add release notes, then **Save → Send changes for review**.
5. After review, the app is live on Google Play. 🎉

If Google says "more testing needed", keep the closed test running, collect more feedback, make an improvement, and apply again.

---

## Part F: AdMob setup

### F1. Create the AdMob account and the app
1. Go to https://apps.admob.com and sign in with the **same Google account**.
2. Finish the sign-up: country **Pakistan**, your time zone, and billing currency. You can't change the currency later.
3. Click **Apps → Add app**.
4. Platform: **Android**.
5. "Is the app listed on a supported app store?" → **No** (it is not live yet).
6. App name: `Crossfour`. Click **Add app**.
7. Copy the **App ID**. It looks like `ca-app-pub-1234567890123456~1234567890` (note the **~**).

### F2. Create 3 ad units
In your app in AdMob, click **Ad units → Add ad unit** and create these one by one:

| Type | Name to use | Settings |
|---|---|---|
| **Banner** | `Banner_Bottom` | Default settings |
| **Interstitial** | `Interstitial_Match_End` | Default settings |
| **Rewarded** | `Rewarded_Bonus` | Reward amount **1**, reward item **bonus** (used for "Undo last move" and "2x coins"). Leave server-side verification off. |

Copy each **ad unit ID**. It looks like `ca-app-pub-1234567890123456/1234567890` (note the **/**).

### F3. GDPR consent message (UMP)
The game already asks for consent with Google's UMP SDK. You only need to create and publish the message.
1. In AdMob, go to **Privacy & messaging**.
2. Open **European regulations (GDPR)** and click **Create message**.
3. Choose the app **Crossfour**, and the language **English** (add more if you like).
4. **Privacy policy URL:** `https://offerpk.github.io/offline-ludo/privacy.html`
5. Keep the options **"Consent"** and **"Manage options"**. You can also turn on **"Close (do not consent)"**.
6. Click **Publish**.
7. (Optional) Also create a **US state regulations** message in the same place and publish it.

### F4. Payments (so you can get paid)
1. In AdMob, go to **Payments** and fill in your payment profile and tax info.
2. When earnings reach about $10, Google mails a **PIN** to your address. Enter it in AdMob.
3. Add your bank account. Google pays when your balance passes the payment threshold.

### F5. Test safely
- Add your own phone as a **test device**: AdMob → **Settings → Test devices**.
- **Never click your own real ads**, and don't ask friends to click them. That can get your AdMob account banned.

### F6. Link AdMob to Google Play (after the app is live)
1. Wait until the app is **published on Google Play** (production).
2. In AdMob, go to **Apps → View all apps → Crossfour → App settings**.
3. Under **App store details**, click **Add** and search for `com.offerpk.offlineludo` or "Crossfour".
4. Select it and click **Add**. AdMob then reviews the app. Ads may be limited until the review is done.
5. (Recommended) **app-ads.txt:** AdMob will give you a line like
   `google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0`.
   It must be at the root of the **website** listed on your Play store page. Ask me and I can set this up. It needs a small `offerpk.github.io` site so the file lives at `https://offerpk.github.io/app-ads.txt`.

---

## Part G: Send me the IDs

When AdMob is ready, send me these 4 values (and your publisher ID for app-ads.txt):

```
App ID:           ca-app-pub-XXXXXXXXXXXXXXXX~XXXXXXXXXX
Banner ID:        ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX
Interstitial ID:  ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX
Rewarded ID:      ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX
Publisher ID:     pub-XXXXXXXXXXXXXXXX
```

Ad IDs are not secret, so it's fine to send them in chat. **Never** send your passwords or keystore file.

Then I will:
1. Put the IDs in `www/js/ads-config.js` and set `IS_TESTING: false`.
2. Put the App ID in `android/app/src/main/AndroidManifest.xml` (`com.google.android.gms.ads.APPLICATION_ID`).
3. Bump the version to **1.3.1 (versionCode 5)**.
4. Tag **v1.3.1** so GitHub Actions builds the signed AAB and creates the release.
5. Give you the new AAB link. You upload it to the closed test track (and later to production).

---

## Simple timeline

| Day | What happens |
|---|---|
| Day 0 | Sign up for Play Console, pay $25, verify identity |
| Day 1–3 | Identity approved. Create the app, fill in App content and the store listing, upload v1.3.0 to closed testing. Set up AdMob. |
| Day 2–7 | Closed test review done. Send the opt-in link to 15–20 testers. Send me the AdMob IDs and I build v1.3.1. |
| Day ~5–21 | 14 continuous days with 12+ testers. Upload v1.3.1 to the closed track. |
| Day ~21 | Apply for production |
| Day ~28 | Production approved. Release v1.3.1. Link AdMob to Play. Add app-ads.txt. |
