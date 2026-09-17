import Router, { response } from 'express';

import { memberController } from '../controllers';

/**
 * This file sets up routing for member routes.
 * @note All paths used here will be prepended with `/api/member`.
 */

const memberRoutes = Router();
memberRoutes.post('/signup', (request, response) => memberController.signup(request, response));
memberRoutes.get('/pending-approval', (request, response) =>
  memberController.listPendingApproval(request, response),
);
memberRoutes.post('/pending-approval/:id/approve', (request, response) =>
  memberController.approveMember(request, response),
);
memberRoutes.post('/is_banned', (request, response) =>
  memberController.isBanned(request, response),
);
memberRoutes.post('/joined', (request, response) => 
  memberController.joinedPlace(request, response));
memberRoutes.get('/getrolename', (request, response) =>
  memberController.getPrimaryRoleName(request, response),
);
memberRoutes.get('/getadminlevel', (request, response) =>
  memberController.getAdminLevel(request, response),
);
memberRoutes.get('/can-manage-security-roles', (request, response) =>
  memberController.canManageSecurityRoles(request, response),
);
memberRoutes.get('/getdonorlevel', (request, response) =>
  memberController.getDonorLevel(request, response),
);
memberRoutes.post('/login', (request, response) => memberController.login(request, response));
memberRoutes.get('/session', (request, response) => memberController.session(request, response));
// The socket server's liveness probe for a session it is already holding open.
memberRoutes.get('/session/status', (request, response) =>
  memberController.sessionStatus(request, response),
);
// The Jail's authority, answered only about the caller. The socket server asks this to
// decide who may hear an inmate and where a jailed citizen may go.
memberRoutes.get('/jail/standing', (request, response) =>
  memberController.jailStanding(request, response),
);
memberRoutes.post('/update_password', (request, response) =>
  memberController.updatePassword(request, response),
);
memberRoutes.get('/get_privacy', (request, response) =>
  memberController.getPrivacy(request, response),
);
memberRoutes.post('/update_privacy', (request, response) =>
  memberController.updatePrivacy(request, response),
);
memberRoutes.post('/update_role', (request, response) =>
  memberController.updatePrimaryRoleId(request, response),
);
memberRoutes.post('/updateinfo', (request, response) =>
  memberController.updateInfo(request, response),
);
memberRoutes.post('/update_avatar', (request, response) =>
  memberController.updateAvatar(request, response),
);
memberRoutes.post('/send_password_reset', (request, response) =>
  memberController.sendPasswordReset(request, response),
);
memberRoutes.post('/reset_password', (request, response) =>
  memberController.resetPassword(request, response),
);
memberRoutes.get('/info', (request, response) => memberController.getInfo(request, response));
memberRoutes.post('/storage', (request, response) => 
  memberController.getStorage(request, response));
memberRoutes.post('/storage/update', (request, response) => 
  memberController.updateStorage(request, response));
memberRoutes.post('/ping', (request, response) => 
  memberController.updateLatestActivity(request, response));
memberRoutes.get('/info/:id', (request, response) => memberController.getInfo(request, response));
memberRoutes.get('/roles/:id?', (request, response) => 
  memberController.getRoles(request, response));
memberRoutes.get('/check3d/:username', (request, response) => 
  memberController.check3d(request, response));
memberRoutes.get('/places', (request, response) => 
  memberController.getActivePlaces(request, response));
memberRoutes.get('/backpack/:username', (request, response) =>
  memberController.getBackpack(request, response));
memberRoutes.get('/online_users', (request, response) =>
  memberController.getOnlineUsers(request, response));
memberRoutes.get('/directory', (request, response) =>
  memberController.getDirectory(request, response));
memberRoutes.get('/remove_account', (request, response) =>
  memberController.removeAccount(request, response));

export { memberRoutes };
