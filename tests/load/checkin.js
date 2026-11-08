// k6 script: 300 people through the door as fast as 10 scanners can go.
import { check } from "k6";
import exec from "k6/execution";
import http from "k6/http";

const data = JSON.parse(open("./.generated/tickets.json"));
const baseUrl = __ENV.BASE_URL || "http://localhost:3100";

export const options = {
  scenarios: {
    door_rush: {
      executor: "shared-iterations",
      vus: 10,
      iterations: data.payloads.length,
      maxDuration: "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
  },
};

export default function scan() {
  const payload = data.payloads[exec.scenario.iterationInTest];
  const response = http.post(
    `${baseUrl}/api/events/${data.eventId}/checkin`,
    JSON.stringify({ payload }),
    { headers: { "content-type": "application/json", cookie: data.cookie } },
  );
  check(response, {
    "checked in": (r) => r.status === 200 && r.json("code") === "OK",
  });
}
