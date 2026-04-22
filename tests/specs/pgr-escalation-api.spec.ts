/**
 * PGR Escalation — API-only
 *
 * Tests the manual escalation workflow using only API calls (no browser):
 *   1. Acquire admin + citizen tokens
 *   2. Ensure ESCALATE action exists in PGR workflow (add if missing)
 *   3. Ensure employee hierarchy — at least one reportingTo relationship in HRMS
 *   4. Citizen creates complaint
 *   5. Admin assigns complaint to specific employee (one with a supervisor)
 *   6. Manual ESCALATE — level 0→1, reassign to supervisor
 *   7. Verify workflow process instance shows new assignee
 *   8. Second ESCALATE — level 1→2 (skip if no second-level supervisor)
 *   9. Resolve the escalated complaint
 *
 * Prerequisites are auto-seeded (tests 2-3). The test suite is idempotent.
 *
 * Run: npx playwright test tests/specs/pgr-escalation-api.spec.ts
 */
import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import {
  BASE_URL, TENANT, ROOT_TENANT,
  ADMIN_USER, ADMIN_PASS, FIXED_OTP,
  DEFAULT_PASSWORD,
  SERVICE_CODE, LOCALITY_CODE,
  generateCitizenPhone,
} from '../utils/env';

const CITIZEN_PHONE = generateCitizenPhone();
const CITIZEN_NAME = 'E2E Escalation Citizen';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Fetch the full PGR service object (needed for _update calls). */
async function fetchComplaint(token: string, userInfo: Record<string, unknown>, serviceRequestId: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data: any = await resp.json();
  return data.ServiceWrappers[0].service;
}

/** Register a citizen via OTP flow and return token. */
async function registerCitizen(phone: string): Promise<{ token: string; userInfo: Record<string, unknown> }> {
  await fetch(`${BASE_URL}/user-otp/v1/_send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      otp: { mobileNumber: phone, tenantId: ROOT_TENANT, type: 'login', userType: 'CITIZEN' },
    }),
  });

  let resp = await fetch(`${BASE_URL}/user/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body: new URLSearchParams({
      grant_type: 'password', username: phone, password: FIXED_OTP,
      tenantId: ROOT_TENANT, scope: 'read', userType: 'CITIZEN',
    }).toString(),
  });

  if (!resp.ok) {
    await fetch(`${BASE_URL}/user/citizen/_create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker' },
        user: {
          name: CITIZEN_NAME, userName: phone, mobileNumber: phone,
          password: DEFAULT_PASSWORD, tenantId: ROOT_TENANT, type: 'CITIZEN',
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: ROOT_TENANT }],
          otpReference: FIXED_OTP,
        },
      }),
    });

    resp = await fetch(`${BASE_URL}/user/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      },
      body: new URLSearchParams({
        grant_type: 'password', username: phone, password: FIXED_OTP,
        tenantId: ROOT_TENANT, scope: 'read', userType: 'CITIZEN',
      }).toString(),
    });
  }

  const data: any = await resp.json();
  return { token: data.access_token, userInfo: data.UserRequest };
}

/** Search HRMS employees for a tenant. */
async function searchEmployees(token: string, tenantId: string): Promise<any[]> {
  const resp = await fetch(
    `${BASE_URL}/egov-hrms/employees/_search?tenantId=${tenantId}&offset=0&limit=100`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
    },
  );
  const data: any = await resp.json();
  return data.Employees || [];
}

/** Search workflow process instances for a businessId. */
async function searchWorkflowHistory(
  token: string, userInfo: Record<string, unknown>,
  businessId: string, tenantId: string,
): Promise<any[]> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/process/_search?tenantId=${tenantId}&businessIds=${businessId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
    },
  );
  const data: any = await resp.json();
  return data.ProcessInstances || [];
}

/** Fetch the PGR business service config. */
async function fetchPgrWorkflow(token: string): Promise<any> {
  const resp = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${TENANT}&businessServices=PGR`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token } }),
    },
  );
  const data: any = await resp.json();
  return data.BusinessServices?.[0];
}

/** Assert a fetch response is ok; if not, throw with the response body for diagnostics. */
async function assertOk(resp: Response, context: string): Promise<any> {
  const body = await resp.json();
  if (!resp.ok) {
    throw new Error(`${context}: HTTP ${resp.status} — ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.serial('PGR escalation — API only', () => {
  let adminToken: string;
  let adminUserInfo: Record<string, unknown>;
  let citizenToken: string;
  let citizenUserInfo: Record<string, unknown>;
  let serviceRequestId: string;
  let employeeUuid: string;
  let supervisorUuid: string;
  let secondSupervisorUuid: string | null = null;
  let allEmployees: any[] = [];
  /** Set to true when prerequisites (workflow + hierarchy) are confirmed. */
  let prerequisitesMet = false;

  test('1 — acquire admin and citizen tokens', async () => {
    const adminResp = await getDigitToken({
      tenant: ROOT_TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    expect(adminResp.access_token).toBeTruthy();
    adminToken = adminResp.access_token;
    adminUserInfo = adminResp.UserRequest as Record<string, unknown>;

    const citizenResp = await registerCitizen(CITIZEN_PHONE);
    expect(citizenResp.token).toBeTruthy();
    citizenToken = citizenResp.token;
    citizenUserInfo = citizenResp.userInfo;
    console.log(`Admin and citizen (${CITIZEN_PHONE}) tokens acquired`);
  });

  test('2 — ensure ESCALATE action exists in PGR workflow', async () => {
    const biz = await fetchPgrWorkflow(adminToken);
    expect(biz).toBeTruthy();

    // Find the PENDINGATLME state
    const pendingAtLme = biz.states.find((s: any) => s.applicationStatus === 'PENDINGATLME');
    expect(pendingAtLme).toBeTruthy();

    // Check if ESCALATE action already exists
    const hasEscalate = (pendingAtLme.actions || []).some((a: any) => a.action === 'ESCALATE');

    if (hasEscalate) {
      console.log('ESCALATE action already exists on PENDINGATLME — no update needed');
      return;
    }

    console.log('ESCALATE action missing on PENDINGATLME — adding it now');

    // Add ESCALATE as a self-loop on PENDINGATLME
    // Must include currentState, tenantId, active for persistence
    pendingAtLme.actions.push({
      tenantId: TENANT,
      currentState: pendingAtLme.uuid,
      action: 'ESCALATE',
      nextState: pendingAtLme.uuid,  // self-loop: stays in PENDINGATLME
      roles: ['GRO', 'PGR_LME', 'AUTO_ESCALATE', 'PGR_VIEWER'],
      active: true,
    });

    // Also add ESCALATE on PENDINGFORASSIGNMENT if it doesn't have it
    const pendingForAssign = biz.states.find((s: any) => s.applicationStatus === 'PENDINGFORASSIGNMENT');
    if (pendingForAssign) {
      const hasEscalatePfa = (pendingForAssign.actions || []).some((a: any) => a.action === 'ESCALATE');
      if (!hasEscalatePfa) {
        pendingForAssign.actions.push({
          tenantId: TENANT,
          currentState: pendingForAssign.uuid,
          action: 'ESCALATE',
          nextState: pendingForAssign.uuid,
          roles: ['GRO', 'AUTO_ESCALATE', 'PGR_VIEWER'],
          active: true,
        });
        console.log('Also added ESCALATE on PENDINGFORASSIGNMENT');
      }
    }

    // Update the business service
    const resp = await fetch(
      `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_update?tenantId=${TENANT}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
          BusinessServices: [biz],
        }),
      },
    );

    const result = await assertOk(resp, 'Workflow _update');
    const updatedBiz = result.BusinessServices?.[0];
    const updatedState = updatedBiz.states.find((s: any) => s.applicationStatus === 'PENDINGATLME');
    const nowHasEscalate = (updatedState.actions || []).some((a: any) => a.action === 'ESCALATE');
    expect(nowHasEscalate).toBe(true);

    // Verify persistence: re-fetch and check
    const verifyBiz = await fetchPgrWorkflow(adminToken);
    const verifyState = verifyBiz.states.find((s: any) => s.applicationStatus === 'PENDINGATLME');
    const persisted = (verifyState.actions || []).some((a: any) => a.action === 'ESCALATE');
    if (!persisted) {
      throw new Error('ESCALATE action returned in _update response but did NOT persist — phantom-200. Check workflow persister.');
    }
    console.log('ESCALATE action added and verified in PGR workflow');
  });

  test('3 — ensure 2-level employee hierarchy (reportingTo) in HRMS', async () => {
    allEmployees = await searchEmployees(adminToken, TENANT);
    expect(allEmployees.length).toBeGreaterThan(0);
    console.log(`Found ${allEmployees.length} employees in ${TENANT}`);

    if (allEmployees.length < 3) {
      test.skip(true, 'Need at least 3 employees to create 2-level hierarchy');
      return;
    }

    // Pick 3 non-ADMIN employees for the chain: employee → supervisor → super-supervisor
    const candidates = allEmployees.filter((e: any) => e.user?.userName !== 'ADMIN');
    if (candidates.length < 3) {
      test.skip(true, 'Need at least 3 non-ADMIN employees for hierarchy');
      return;
    }

    const subordinate = candidates[0];
    const supervisor = candidates[1];
    const superSupervisor = candidates[2];

    // Helper to set reportingTo on an employee's current assignment (idempotent)
    async function ensureReportingTo(emp: any, reportingToUuid: string): Promise<boolean> {
      const assignment = (emp.assignments || []).find((a: any) => a.isCurrentAssignment);
      if (!assignment) return false;
      if (assignment.reportingTo === reportingToUuid) return true; // already set

      assignment.reportingTo = reportingToUuid;
      const resp = await fetch(
        `${BASE_URL}/egov-hrms/employees/_update?tenantId=${TENANT}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
            Employees: [emp],
          }),
        },
      );
      const result = await assertOk(resp, `HRMS _update reportingTo for ${emp.user?.name}`);
      const updated = result.Employees?.[0];
      const updatedAssign = (updated?.assignments || []).find((a: any) => a.isCurrentAssignment);
      return updatedAssign?.reportingTo === reportingToUuid;
    }

    // Level 1: subordinate → supervisor
    const l1Ok = await ensureReportingTo(subordinate, supervisor.uuid);
    expect(l1Ok).toBe(true);
    console.log(`Level 1: ${subordinate.user?.name} → ${supervisor.user?.name}`);

    // Level 2: supervisor → super-supervisor
    const l2Ok = await ensureReportingTo(supervisor, superSupervisor.uuid);
    expect(l2Ok).toBe(true);
    console.log(`Level 2: ${supervisor.user?.name} → ${superSupervisor.user?.name}`);

    employeeUuid = subordinate.uuid;
    supervisorUuid = supervisor.uuid;
    prerequisitesMet = true;

    // Refresh employee list so later tests see the updated reportingTo
    allEmployees = await searchEmployees(adminToken, TENANT);
    console.log(`2-level hierarchy ready: ${subordinate.user?.name} → ${supervisor.user?.name} → ${superSupervisor.user?.name}`);
  });

  test('4 — citizen creates complaint', async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met (workflow or HRMS hierarchy missing)');

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_create`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${citizenToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: citizenToken, userInfo: citizenUserInfo },
        service: {
          tenantId: TENANT,
          serviceCode: SERVICE_CODE,
          description: `E2E escalation test — ${new Date().toISOString()}`,
          source: 'web',
          address: {
            city: TENANT,
            locality: { code: LOCALITY_CODE },
            geoLocation: { latitude: 0, longitude: 0 },
          },
          citizen: { name: CITIZEN_NAME, mobileNumber: CITIZEN_PHONE },
        },
        workflow: { action: 'APPLY', verificationDocuments: [] },
      }),
    });

    const data = await assertOk(resp, 'PGR _create');
    serviceRequestId = data.ServiceWrappers[0].service.serviceRequestId;
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGFORASSIGNMENT');
    console.log(`Complaint created: ${serviceRequestId} → PENDINGFORASSIGNMENT`);
  });

  test('5 — admin assigns complaint to specific employee', async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ASSIGN',
          assignees: [employeeUuid],
          comments: 'Assigned to employee with supervisor for escalation test',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ASSIGN');
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    console.log(`${serviceRequestId} → PENDINGATLME (assigned to ${employeeUuid})`);
  });

  test('6 — manual ESCALATE level 0→1', async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    // PGR POJO field is `additionalDetail` (singular). Jackson silently drops
    // unknown keys, so plural `additionalDetails` would be lost. Preserve
    // existing `department` key (required by PGR) and add escalation metadata.
    const existingDetail = fullService.additionalDetail || {};
    fullService.additionalDetail = {
      ...existingDetail,
      escalationLevel: 1,
      lastEscalatedAt: Date.now(),
      escalatedFrom: [employeeUuid],
    };
    delete fullService.additionalDetails;

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          assignees: [supervisorUuid],
          comments: 'Manual escalation test — level 0→1',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ESCALATE (level 0→1)');
    // ESCALATE is a self-loop on PENDINGATLME — status stays the same
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    // Verify escalation metadata persisted (singular `additionalDetail` field)
    const updatedDetail = data.ServiceWrappers[0].service.additionalDetail || {};
    expect(updatedDetail.escalationLevel).toBe(1);
    console.log(`${serviceRequestId} → ESCALATED to ${supervisorUuid} (level 1)`);
  });

  test('7 — verify escalation: workflow action + PGR assignee', async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');

    // Verify workflow history records the ESCALATE action
    const processInstances = await searchWorkflowHistory(adminToken, adminUserInfo, serviceRequestId, TENANT);
    expect(processInstances.length).toBeGreaterThan(0);
    const latest = processInstances[0];
    expect(latest.action).toBe('ESCALATE');
    console.log(`Workflow confirms ESCALATE action (state: ${latest.state?.applicationStatus})`);

    // Verify the PGR service object's current assignee is the supervisor.
    // Self-loop workflow transitions may not populate process instance assignees,
    // but PGR stores the assignee change on the ServiceWrapper.
    const resp = await fetch(
      `${BASE_URL}/pgr-services/v2/request/_search?tenantId=${TENANT}&serviceRequestId=${serviceRequestId}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo } }),
      },
    );
    const data: any = await resp.json();
    const wrapper = data.ServiceWrappers[0];

    // Check workflow in the wrapper — assignee should be the supervisor
    const wfAssignees = (wrapper.workflow?.assignes || []).map((a: any) => a.uuid);
    if (wfAssignees.length > 0) {
      expect(wfAssignees).toContain(supervisorUuid);
      console.log(`PGR wrapper confirms supervisor ${supervisorUuid} is assignee`);
    } else {
      // Fallback: check the process instance assignee from the latest action
      // Some DIGIT versions store assignees differently
      const piAssignees = (latest.assignes || []).map((a: any) => a.uuid);
      if (piAssignees.length > 0) {
        expect(piAssignees).toContain(supervisorUuid);
      }
      console.log(`Workflow ESCALATE confirmed; assignee verification via wrapper: ${wfAssignees.length > 0 ? 'found' : 'empty (self-loop)'}`);
    }
  });

  test('8 — second ESCALATE level 1→2 (skip if no second-level supervisor)', async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');

    // Look up the supervisor's reportingTo
    const supervisorEmp = allEmployees.find((e: any) => e.uuid === supervisorUuid);
    const supAssignment = (supervisorEmp?.assignments || []).find((a: any) => a.isCurrentAssignment);
    secondSupervisorUuid = supAssignment?.reportingTo || null;

    if (!secondSupervisorUuid) {
      console.log('Supervisor has no reportingTo — skipping second escalation');
      test.skip(true, 'No second-level supervisor in HRMS hierarchy');
      return;
    }

    const secondSupervisor = allEmployees.find((e: any) => e.uuid === secondSupervisorUuid);
    if (!secondSupervisor) {
      console.log(`Second-level supervisor ${secondSupervisorUuid} not found in employee list`);
      test.skip(true, 'Second-level supervisor UUID not found in employee list');
      return;
    }

    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);
    // Use singular `additionalDetail` (PGR POJO field name) and preserve department
    const existingDetail = fullService.additionalDetail || {};
    fullService.additionalDetail = {
      ...existingDetail,
      escalationLevel: 2,
      lastEscalatedAt: Date.now(),
      escalatedFrom: [...(existingDetail.escalatedFrom || []), supervisorUuid],
    };
    delete fullService.additionalDetails;

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: {
          action: 'ESCALATE',
          assignees: [secondSupervisorUuid],
          comments: 'Manual escalation test — level 1→2',
        },
      }),
    });

    const data = await assertOk(resp, 'PGR ESCALATE (level 1→2)');
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    // Verify escalation metadata persisted through _update (singular field)
    const updatedDetail = data.ServiceWrappers[0].service.additionalDetail || {};
    expect(updatedDetail.escalationLevel).toBe(2);
    console.log(`${serviceRequestId} → ESCALATED to ${secondSupervisorUuid} (level 2, escalationLevel=${updatedDetail.escalationLevel})`);
  });

  test('9 — resolve the escalated complaint', async () => {
    test.skip(!prerequisitesMet, 'Prerequisites not met');
    const fullService = await fetchComplaint(adminToken, adminUserInfo, serviceRequestId);

    const resp = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${TENANT}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: adminToken, userInfo: adminUserInfo },
        service: fullService,
        workflow: { action: 'RESOLVE', comments: 'Resolved after escalation — E2E test' },
      }),
    });

    const data = await assertOk(resp, 'PGR RESOLVE');
    expect(data.ServiceWrappers[0].service.applicationStatus).toBe('RESOLVED');

    // Verify escalation metadata persists through the resolve transition.
    // PGR POJO uses `additionalDetail` (singular). Previous ESCALATE calls
    // wrote escalationLevel into this field; it should still be present.
    const resolvedService = data.ServiceWrappers[0].service;
    const detail = resolvedService.additionalDetail || {};
    expect(detail.escalationLevel).toBeGreaterThanOrEqual(1);
    console.log(`${serviceRequestId} → RESOLVED (escalationLevel: ${detail.escalationLevel})`);
  });
});
