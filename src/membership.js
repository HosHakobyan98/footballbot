class Membership {
  constructor(sponsorsEnv) {
    this.loggerName = "Membership";
    this.sponsors = sponsorsEnv ? sponsorsEnv.split(",") : [];
  }

  getSponsorsList() {
    return this.sponsors.map((url) => this.extractChannelName(url));
  }

  async verify(bot, chatId) {
    if (!this.sponsors.length) {
      console.warn(
        `[${this.loggerName}] Sponsors list is empty. Skipping verification...`,
      );
      return true;
    }

    return this.checkMembershipRecursive(bot, chatId, 0);
  }

  async checkMembershipRecursive(bot, chatId, index) {
    if (index >= this.sponsors.length) {
      return true;
    }

    try {
      const channel = this.extractChannelName(this.sponsors[index]);
      const member = await bot.getChatMember(`@${channel}`, chatId);

      if (this.isValidMemberStatus(member.status)) {
        return this.checkMembershipRecursive(bot, chatId, index + 1);
      } else {
        return false;
      }
    } catch (error) {
      console.warn(
        `[${this.loggerName}] Membership verification error: ${error.message}`,
      );
      return false;
    }
  }

  isValidMemberStatus(status) {
    return ["administrator", "member", "creator"].includes(status);
  }

  extractChannelName(url) {
    const match = url.match(/(?:https?:\/\/)?t\.me\/(?:@)?(\w+)/);
    if (match && match[1]) {
      return match[1];
    }
    return url.replace("@", "").trim();
  }
}

module.exports = Membership;
