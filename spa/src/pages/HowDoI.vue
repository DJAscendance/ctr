<template>
  <div class="w-full h-full overflow-y-auto flex flex-col items-center px-8">
    <h1 class="text-2xl font-semibold mt-4 mb-6">How Do I?</h1>

    <div class="w-2/3 mb-8">
      <p class="mb-2">Jump to a topic:</p>
      <ul class="list-disc list-inside">
        <li><a href="#become-a-member">Become a Member</a></li>
        <li><a href="#get-into-3d">Get Into 3D</a></li>
        <li><a href="#chat">Chat in 2D / 3D &amp; Voice Chat</a></li>
        <li><a href="#mute-a-voice">Mute a Voice</a></li>
        <li><a href="#visit-a-home">Visit a Home</a></li>
        <li><a href="#furnish-my-home">Furnish My Home</a></li>
        <li><a href="#placing-objects">Placing Objects</a></li>
        <li><a href="#clubs">Join / Start / Visit a Club</a></li>
        <li><a href="#message-boards">Use the Message Boards</a></li>
        <li><a href="#give-feedback">Give Feedback</a></li>
        <li><a href="#get-a-job">Get a Job</a></li>
        <li><a href="#alert-security">Alert Security</a></li>
        <li><a href="#privacy-policy">Privacy Policy</a></li>
      </ul>
    </div>

    <div class="w-2/3 text-left">
      <section id="become-a-member" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Become a Member</span></div>
        <h2 class="text-xl font-semibold mb-2">Become a Member</h2>
        <p>
          Cybertown is free to join. Once you're a member you can access 2D and 3D chat and
          message boards, buy or trade objects, and invite friends to your very own 3D home to
          hang out or party.
        </p>
      </section>

      <section id="get-into-3d" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Get Into 3D</span></div>
        <h2 class="text-xl font-semibold mb-2">Get Into 3D</h2>
        <p>
          The Cybertown 3D VR environment lets you move through the 3D city and homes using an
          avatar &mdash; a 3D representation of yourself. As a member you can chat, use message
          boards, buy and trade objects, and interact with other avatars, plus invite friends
          over to your 3D home to hang out.
        </p>
      </section>

      <section id="chat" class="mb-8">
        <div class="flex flex-row flex-wrap mb-2">
          <span class="btn-ui-inline">Chat in 2D</span>
          <span class="btn-ui-inline">Chat in 3D</span>
          <span class="btn-ui-inline">Voice Chat</span>
        </div>
        <h2 class="text-xl font-semibold mb-2">Chat in 2D / 3D &amp; Voice Chat</h2>
        <p class="mb-2">
          2D chat is great if you just want to talk to someone quickly. 3D chat lets you move
          your avatar around and interact with the world while you talk. You can choose your
          default chat mode from your Personal Info page.
        </p>
        <p>
          Voice chat lets you talk out loud to nearby citizens instead of typing &mdash; look for
          the voice controls near the chat window once you're in 3D.
        </p>
      </section>

      <section id="mute-a-voice" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Mute Voice</span></div>
        <h2 class="text-xl font-semibold mb-2">Mute a Voice</h2>
        <p class="mb-2">
          <b>Mute All Voices:</b> Right click on your nickname under the People tab, select
          Voice, then Mute All. This also mutes your own voice.
        </p>
        <p>
          You can also mute a single citizen individually the same way &mdash; right click their
          nickname and select Mute instead of Mute All.
        </p>
      </section>

      <section id="visit-a-home" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Visit a Home</span></div>
        <h2 class="text-xl font-semibold mb-2">Visit a Home</h2>
        <p>
          Find a citizen through the <router-link to="/directory">Citizen Directory</router-link>
          and click their name to visit their home, if they have one set up.
        </p>
      </section>

      <section id="furnish-my-home" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Furnish My Home</span></div>
        <h2 class="text-xl font-semibold mb-2">Furnish My Home</h2>
        <p class="mb-2">
          Before you go shopping, check how much City Cash (CC) you have on your Personal Info
          page &mdash; shops only accept City Cash. You can have a maximum of 32 objects in your
          home at once.
        </p>
        <p>
          Use the Jump Gate or the City Map to get to the Mall, browse the stores, and buy
          objects for your backpack. From there, see Placing Objects below to decorate your
          home with them.
        </p>
      </section>

      <section id="placing-objects" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Placing Objects</span></div>
        <h2 class="text-xl font-semibold mb-2">Placing Objects</h2>
        <p class="mb-2">
          Remember: you can only have a maximum of 32 objects in your home. Go to your 3D home
          via My House on the Control Panel, then open your backpack to see what you own.
        </p>
        <p>
          Right-clicking an item in your backpack gives you options to Drop it into the room
          you're currently in, Destroy it, or view its Properties. Once dropped, it moves from
          your backpack list to your home's objects list.
        </p>
      </section>

      <section id="clubs" class="mb-8">
        <div class="flex flex-row flex-wrap mb-2">
          <span class="btn-ui-inline">Join a Club</span>
          <span class="btn-ui-inline">Start a Club</span>
          <span class="btn-ui-inline">Visit a Club</span>
        </div>
        <h2 class="text-xl font-semibold mb-2">Join / Start / Visit a Club</h2>
        <p class="mb-2">
          Browse the <router-link to="/clublist/directory">Club Directory</router-link> to see
          what clubs are currently available, filterable by name, keyword, creation date, or
          member count.
        </p>
        <p>
          To join, find a club you like in the directory and follow its join instructions. To
          start your own club, use Create a Club from the club tools. To visit a club, click
          through to its page from the directory.
        </p>
      </section>

      <section id="message-boards" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Use Message Boards</span></div>
        <h2 class="text-xl font-semibold mb-2">Use the Message Boards</h2>
        <p class="mb-2">
          As you move through Cybertown, most locations have a message board associated with
          them, with posts and announcements shared by other citizens &mdash; a great way to see
          what's going on in that area.
        </p>
        <p>
          To add your own comment or reply, click Post and fill in the form. Please keep your
          comments appropriate to the location you're posting in.
        </p>
      </section>

      <section id="give-feedback" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Give Feedback</span></div>
        <h2 class="text-xl font-semibold mb-2">Give Feedback</h2>
        <p>
          Have a question, comment, or suggestion? Click Feedback on the Control Panel to open
          the feedback board for wherever you're currently standing, or reach out through the
          <a href="https://github.com/CybertownRevival/ctr/issues" target="_blank">
            issue tracker</a> for site-wide feedback.
        </p>
      </section>

      <section id="get-a-job" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Get a Job</span></div>
        <h2 class="text-xl font-semibold mb-2">Get a Job</h2>
        <p class="mb-2">
          Want more City Cash? Check the Employment Office (reachable from the City Map) for
          current job postings.
        </p>
        <p>
          If you find a listing you like, apply directly to the poster's home rather than
          replying on the message board &mdash; find their name in the
          <router-link to="/directory">Citizen Directory</router-link> and visit their home to
          apply.
        </p>
      </section>

      <section id="alert-security" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Alert Security</span></div>
        <h2 class="text-xl font-semibold mb-2">Alert Security</h2>
        <p class="mb-2">
          All messages to Security are taken seriously and answered as quickly as possible.
          False reports may result in a fine.
        </p>
        <p class="mb-2">
          To send an alert, open the Online Citizens / Instant Message Center and use the
          Security Alert option. If no security personnel are currently online, you'll be given
          the option to message them directly instead.
        </p>
        <div class="flex flex-row gap-4 mt-4">
          <img
            src="/assets/img/howdoi/secure1.webp"
            alt="Security alert example"
            class="max-w-xs"
          />
          <img
            src="/assets/img/howdoi/secure2.webp"
            alt="Security alert example"
            class="max-w-xs"
          />
        </div>
      </section>

      <section id="privacy-policy" class="mb-8">
        <div class="mb-2"><span class="btn-ui-inline">Privacy Policy</span></div>
        <h2 class="text-xl font-semibold mb-2">Privacy Policy</h2>
        <p class="mb-2">
          Cybertown Revival is a non-commercial, community-run revival of the original
          Cybertown. We only use account information (like your email and IP address) to run
          and secure the service &mdash; not for advertising or to sell to third parties.
        </p>
        <p>
          Questions about your data? Reach out via the
          <a href="https://github.com/CybertownRevival/ctr/issues" target="_blank">
            issue tracker</a>.
        </p>
      </section>
    </div>
  </div>
</template>

<script>
import Vue from "vue";

export default Vue.extend({
  name: "HowDoIPage",
});
</script>
