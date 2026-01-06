// server/src/controllers/room-access.controller.ts
/**
 * Room Access Controller
 * 
 * Handles authentication and authorization for audio/video calling rooms.
 * Ensures only valid users can create or join calls.
 */

import { Request, Response } from 'express';
import { db } from '../config/firebase';

/**
 * Check room access for a group call
 * GET /api/groups/:groupId/room-access
 * 
 * Returns:
 * - userRole: 'admin' | 'moderator' | 'member'
 * - hasAccess: boolean
 * - roomId: string (groupId)
 * - permissions: object
 */
export const checkGroupRoomAccess = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { groupId } = req.params;
    const userId = req.user!.uid;

    // Verify group exists
    const groupDoc = await db.collection('groups').doc(groupId).get();
    if (!groupDoc.exists) {
      return res.status(404).json({ 
        error: 'Group not found.',
        hasAccess: false 
      });
    }

    // Check if user is a member of the group
    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(userId)
      .get();

    if (!memberDoc.exists) {
      return res.status(403).json({ 
        error: 'You must be a member of this group to join calls.',
        hasAccess: false,
        userRole: null
      });
    }

    const memberData = memberDoc.data();
    const userRole = memberData?.role || 'member';
    const groupData = groupDoc.data();

    // Determine permissions based on role
    const permissions = {
      canStartCall: userRole === 'admin' || userRole === 'moderator' || userRole === 'member', // All members can start calls
      canEndCall: userRole === 'admin' || userRole === 'moderator', // Only admins/moderators can end calls
      canMuteOthers: userRole === 'admin' || userRole === 'moderator', // Only admins/moderators can mute others
      canShareScreen: true, // All members can share screen
      canInvite: userRole === 'admin' || userRole === 'moderator' // Only admins/moderators can invite
    };

    return res.status(200).json({
      hasAccess: true,
      userRole: userRole as 'admin' | 'moderator' | 'member',
      roomId: groupId,
      roomType: 'group',
      roomName: groupData?.name || 'Unknown Group',
      permissions,
      metadata: {
        groupId,
        privacy: groupData?.privacy || 'private',
        memberCount: (await db.collection('groups').doc(groupId).collection('members').get()).size
      }
    });

  } catch (error) {
    console.error('❌ Error checking group room access:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while checking room access.',
      hasAccess: false 
    });
  }
};

/**
 * Check room access for a study session call
 * GET /api/sessions/:sessionId/room-access
 * 
 * Returns:
 * - userRole: 'host' | 'participant'
 * - hasAccess: boolean
 * - roomId: string (sessionId)
 * - permissions: object
 */
export const checkSessionRoomAccess = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { sessionId } = req.params;
    const userId = req.user!.uid;

    // Verify session exists
    const sessionDoc = await db.collection('sessions').doc(sessionId).get();
    if (!sessionDoc.exists) {
      return res.status(404).json({ 
        error: 'Session not found.',
        hasAccess: false 
      });
    }

    const sessionData = sessionDoc.data();
    const groupId = sessionData?.groupId;

    if (!groupId) {
      return res.status(400).json({ 
        error: 'Session is missing groupId.',
        hasAccess: false 
      });
    }

    // Check if user is a member of the group (required to join session)
    const memberDoc = await db
      .collection('groups')
      .doc(groupId)
      .collection('members')
      .doc(userId)
      .get();

    if (!memberDoc.exists) {
      return res.status(403).json({ 
        error: 'You must be a member of this group to join the session.',
        hasAccess: false,
        userRole: null
      });
    }

    const memberData = memberDoc.data();
    const groupMemberRole = memberData?.role || 'member';
    
    // Determine if user is host (creator) or participant
    const isHost = sessionData?.creatorId === userId;
    const userRole = isHost ? 'host' : 'participant';

    // Get group data for additional context
    const groupDoc = await db.collection('groups').doc(groupId).get();
    const groupData = groupDoc.data();

    // Determine permissions based on role
    const permissions = {
      canStartCall: true, // All members can start calls
      canEndCall: isHost || groupMemberRole === 'admin' || groupMemberRole === 'moderator', // Host and admins can end
      canMuteOthers: isHost || groupMemberRole === 'admin' || groupMemberRole === 'moderator', // Host and admins can mute
      canShareScreen: true, // All members can share screen
      canInvite: groupMemberRole === 'admin' || groupMemberRole === 'moderator' // Only admins/moderators can invite
    };

    return res.status(200).json({
      hasAccess: true,
      userRole,
      roomId: sessionId,
      roomType: 'session',
      roomName: sessionData?.title || 'Unknown Session',
      permissions,
      metadata: {
        sessionId,
        groupId,
        creatorId: sessionData?.creatorId,
        startTime: sessionData?.startTime,
        description: sessionData?.description
      }
    });

  } catch (error) {
    console.error('❌ Error checking session room access:', error);
    return res.status(500).json({ 
      error: 'An unexpected error occurred while checking room access.',
      hasAccess: false 
    });
  }
};

