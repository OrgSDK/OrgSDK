import { router } from "../procedures";
import { approve } from "./approve";
import { discover } from "./discover";
import { exchange } from "./exchange";
export const studioRouter = router({ approve, discover, exchange });
