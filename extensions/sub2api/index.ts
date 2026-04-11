import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildSub2ApiAnthropicProvider } from "./anthropic-provider.js";
import {
  sub2ApiAnthropicMediaUnderstandingProvider,
  sub2ApiOpenAIMediaUnderstandingProvider,
} from "./media-understanding-provider.js";
import { buildSub2ApiOpenAIProvider } from "./openai-provider.js";

export default definePluginEntry({
  id: "sub2api",
  name: "Sub2API Provider",
  description: "Bundled Sub2API provider plugin",
  register(api) {
    api.registerProvider(buildSub2ApiOpenAIProvider());
    api.registerProvider(buildSub2ApiAnthropicProvider());
    api.registerMediaUnderstandingProvider(sub2ApiOpenAIMediaUnderstandingProvider);
    api.registerMediaUnderstandingProvider(sub2ApiAnthropicMediaUnderstandingProvider);
  },
});
