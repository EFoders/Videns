// Checks the schema cannot express. Each one guards an honesty rule: a symbol that
// contradicts its stated affiliation, a group more confident than its members' identities
// allow, an ellipse that is not an ellipse. All are rejected rather than drawn.

import type { Entity, Group, PictureMessage, PositionUncertainty, Sensor } from "./generated/picture.ts";
import { IDENTITY_LABEL, sidcIdentity } from "./identity.ts";
import type { Issue } from "./validate.ts";

/** Covariance determinant tolerance, square metres squared: rounding, not a real negative. */
const PSD_TOLERANCE = 1e-6;

export function semanticIssues(message: PictureMessage): Issue[] {
  const issues: Issue[] = [];
  switch (message.type) {
    case "snapshot":
      message.entities.forEach((e, i) => checkEntity(e, `/entities/${i}`, issues));
      message.groups.forEach((g, i) => checkGroup(g, `/groups/${i}`, issues));
      message.sensors.forEach((s, i) => checkSensor(s, `/sensors/${i}`, issues));
      checkUnique(message.entities.map((e) => e.entity_id), "/entities", issues);
      checkUnique(message.groups.map((g) => g.group_id), "/groups", issues);
      checkUnique(message.sensors.map((s) => s.sensor_id), "/sensors", issues);
      break;
    case "delta":
      message.upsert?.entities?.forEach((e, i) => checkEntity(e, `/upsert/entities/${i}`, issues));
      message.upsert?.groups?.forEach((g, i) => checkGroup(g, `/upsert/groups/${i}`, issues));
      message.upsert?.sensors?.forEach((s, i) => checkSensor(s, `/upsert/sensors/${i}`, issues));
      break;
    default:
      break;
  }
  return issues;
}

function checkSymbol(sidc: string, identity: keyof typeof IDENTITY_LABEL, path: string, issues: Issue[]): void {
  const coded = sidcIdentity(sidc);
  if (coded === undefined) {
    issues.push({ path: `${path}/symbol/sidc`, message: `symbol code ${sidc} does not carry a standard identity` });
  } else if (coded !== identity) {
    issues.push({
      path: `${path}/symbol/sidc`,
      message: `symbol code ${sidc} says ${IDENTITY_LABEL[coded]} but affiliation says ${IDENTITY_LABEL[identity]}`,
    });
  }
}

function checkEntity(entity: Entity, path: string, issues: Issue[]): void {
  checkSymbol(entity.symbol.sidc, entity.affiliation.identity, path, issues);
  if (entity.position_uncertainty) checkUncertainty(entity.position_uncertainty, `${path}/position_uncertainty`, issues);
  if (Date.parse(entity.last_seen) < Date.parse(entity.first_seen)) {
    issues.push({ path: `${path}/last_seen`, message: "last_seen is before first_seen" });
  }
  entity.fix_evidence?.positions?.forEach((p, i) =>
    checkUncertainty(p.uncertainty, `${path}/fix_evidence/positions/${i}/uncertainty`, issues),
  );
}

function checkUncertainty(u: PositionUncertainty, path: string, issues: Issue[]): void {
  if (u.ellipse && u.ellipse.semi_minor_m > u.ellipse.semi_major_m) {
    issues.push({ path: `${path}/ellipse`, message: "semi_minor_m is larger than semi_major_m" });
  }
  if (u.cov_en_m2) {
    const { ee, en, nn } = u.cov_en_m2;
    if (ee * nn - en * en < -PSD_TOLERANCE) {
      issues.push({ path: `${path}/cov_en_m2`, message: "covariance is not positive semi-definite" });
    }
  }
}

function checkGroup(group: Group, path: string, issues: Issue[]): void {
  if (group.confidence > group.member_identity_bound) {
    issues.push({
      path: `${path}/confidence`,
      message: `confidence ${group.confidence} exceeds the member identity bound ${group.member_identity_bound}`,
    });
  }
  checkUnique(group.members.map((m) => m.entity_id), `${path}/members`, issues);
}

function checkSensor(sensor: Sensor, path: string, issues: Issue[]): void {
  checkSymbol(sensor.symbol.sidc, sensor.affiliation.identity, path, issues);
}

function checkUnique(ids: string[], path: string, issues: Issue[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) issues.push({ path, message: `duplicate id "${id}"` });
    seen.add(id);
  }
}
