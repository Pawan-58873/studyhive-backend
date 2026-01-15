    // server/src/controllers/group.controller.ts
    import { z } from 'zod';
    import { io } from '../../index';
    import { Request, Response } from 'express';
    import { db, admin } from '../config/firebase';
    import { insertGroupSchema, insertMessageSchema, User } from '../shared/schema';
    import { nanoid } from 'nanoid';
    import { FieldValue } from 'firebase-admin/firestore';
    import { sendGroupInviteNotification, sendMessageNotification } from '../services/notification.service';
    import { moderateMessage } from '../services/moderation.service';

    export const createGroup = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const creatorId = req.user!.uid;
        const groupData = insertGroupSchema.parse({ ...req.body, creatorId });

        const userDocRef = db.collection('users').doc(creatorId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
        return res.status(404).send({ error: 'Creator user profile not found.' });
        }
        const creatorProfile = userDoc.data() as User;

        const batch = db.batch();
        const groupDocRef = db.collection('groups').doc();
        
        const newGroupData = {
        ...groupData,
        inviteCode: nanoid(8).toUpperCase(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        };

        batch.set(groupDocRef, newGroupData);

        const memberDocRef = groupDocRef.collection('members').doc(creatorId);
        batch.set(memberDocRef, {
        role: 'admin',
        joinedAt: FieldValue.serverTimestamp(),
        name: `${creatorProfile.firstName || ''} ${creatorProfile.lastName || ''}`.trim() || creatorProfile.username,
        profileImageUrl: creatorProfile.profileImageUrl || '',
        });

        batch.update(userDocRef, { groupIds: FieldValue.arrayUnion(groupDocRef.id) });

        const userConversationRef = db.collection('users').doc(creatorId).collection('conversations').doc(groupDocRef.id);
        batch.set(userConversationRef, {
            name: newGroupData.name,
            profileImageUrl: newGroupData.coverImage || '',
            type: 'group',
            timestamp: FieldValue.serverTimestamp(),
            lastMessage: 'You created the group.',
            unreadCount: 0 // --- UNREAD COUNT ---
        });

        await batch.commit();
        
        // Return groupId for navigation and refresh
        res.status(201).send({ 
            message: 'Group created successfully!', 
            groupId: groupDocRef.id, // Added for frontend navigation
            group: { id: groupDocRef.id, ...newGroupData } 
        });

    } catch (error) {
        console.error("Error creating group:", error);
        res.status(500).send({ error: 'Failed to create group.' });
    }
    };


    // Apni group.controller.ts file mein purane sendGroupMessage function ko is naye, FINAL version se replace karein

export const sendGroupMessage = async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(500).send({ error: 'Database not initialized.' });
    }

    const { groupId } = req.params;
    const senderId = req.user!.uid;
    const clientPayload = req.body;

    const userDoc = await db.collection('users').doc(senderId).get();
    if (!userDoc.exists) {
      return res.status(404).send({ error: 'Sender user profile not found.' });
    }
    const senderProfile = userDoc.data() as User;
    const senderName = `${senderProfile.firstName || ''} ${senderProfile.lastName || ''}`.trim() || senderProfile.username;

    const fullPayload = {
      ...clientPayload,
      senderId: senderId,
      senderName: senderName,
      senderProfileImageUrl: senderProfile.profileImageUrl || undefined,
    };
    
    const validatedData = insertMessageSchema.parse(fullPayload);

    // ===================================
    // Moderation Check
    // ===================================
    // Check message content for negative words and apply moderation rules
    // Note: Suspension check is already done by middleware, but we still
    // need to check message content here for word violations.
    const moderationResult = await moderateMessage(senderId, validatedData.content);

    if (!moderationResult.isAllowed) {
      // Message contains negative words or user is suspended
      return res.status(403).json({
        error: 'Message blocked by moderation system',
        message: moderationResult.message,
        action: moderationResult.action,
        warningCount: moderationResult.warningCount,
      });
    }

    // Message passed moderation, proceed with saving
    const messageData = {
      ...validatedData,
      createdAt: FieldValue.serverTimestamp(),
    };
    
    // --- YEH HAI NAYA CODE ---
    const batch = db.batch();
    const messageRef = db.collection('groups').doc(groupId).collection('messages').doc();
    batch.set(messageRef, messageData);

    // Get group data for notifications
    const groupDoc = await db.collection('groups').doc(groupId).get();
    const groupData = groupDoc.data();
    
    // Get all members of the group to update their conversation lists
    const membersSnapshot = await db.collection('groups').doc(groupId).collection('members').get();
    
    membersSnapshot.docs.forEach(memberDoc => {
      const memberId = memberDoc.id;
      const conversationRef = db!.collection('users').doc(memberId).collection('conversations').doc(groupId);
      
      const lastMessageContent = `${senderName}: ${validatedData.content}`;
      const lastMessageForSelf = `You: ${validatedData.content}`;
      
      if (memberId !== senderId) {
        // For other members, update last message and increment unread count
        batch.set(conversationRef, { 
          lastMessage: lastMessageContent, 
          timestamp: FieldValue.serverTimestamp(), 
          unreadCount: FieldValue.increment(1) 
        }, { merge: true }); // Use merge: true to avoid overwriting other fields
      } else {
        // For the sender, just update the last message
        batch.set(conversationRef, { 
          lastMessage: lastMessageForSelf, 
          timestamp: FieldValue.serverTimestamp() 
        }, { merge: true });
      }
    });

    await batch.commit();
    // --- NAYA CODE KHATAM ---

    const savedMessageDoc = await messageRef.get();
    const savedMessage = {
      id: savedMessageDoc.id,
      ...savedMessageDoc.data(),
      createdAt: savedMessageDoc.data()?.createdAt.toDate().toISOString(),
    };
    
    io.to(groupId).emit('newMessage', { message: savedMessage });
    
    // Send push notifications to group members (except sender)
    try {
      const memberIds = membersSnapshot.docs
        .map(doc => doc.id)
        .filter(id => id !== senderId);
      
      if (memberIds.length > 0) {
        // Import sendNotificationToUsers for batch sending
        const { sendNotificationToUsers } = await import('../services/notification.service');
        
        // Send notifications to all members in background (don't wait)
        sendNotificationToUsers(memberIds, {
          type: 'message',
          title: `New message in ${groupData?.name || 'group'}`,
          message: `${senderName}: ${validatedData.content.substring(0, 100)}${validatedData.content.length > 100 ? '...' : ''}`,
          relatedId: groupId,
          data: {
            groupId,
            senderName,
            senderId,
          },
        }).catch(err => console.error('Error sending message notifications:', err));
      }
    } catch (notifError) {
      console.error('Error sending message notifications:', notifError);
      // Don't fail the request if notification fails
    }
    
    res.status(201).json(savedMessage);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).send({ error: "Invalid message payload", details: error.errors });
    }
    console.error("Error sending message:", error);
    res.status(500).send({ error: 'Failed to send message.' });
  }
};


    export const addMemberToGroup = async (req: Request, res: Response) => {
        try {
            if (!db) {
                return res.status(500).send({ error: 'Database not initialized.' });
            }

            const { groupId } = req.params;
            const { newUserEmail } = req.body;
            const requesterId = req.user!.uid;

            const requesterMemberDoc = await db.collection('groups').doc(groupId).collection('members').doc(requesterId).get();
            if (!requesterMemberDoc.exists || requesterMemberDoc.data()?.role !== 'admin') {
                return res.status(403).send({ error: 'Only group admins can add new members.' });
            }

            const usersQuery = db.collection('users').where('email', '==', newUserEmail).limit(1);
            const userSnapshot = await usersQuery.get();
            if (userSnapshot.empty) {
                return res.status(404).send({ error: 'User with that email not found.' });
            }
            const newUserDoc = userSnapshot.docs[0];
            const newUserId = newUserDoc.id;
            const newUserProfile = newUserDoc.data() as User;
            const groupDoc = await db.collection('groups').doc(groupId).get();
            const groupData = groupDoc.data();

            const newMemberDoc = await db.collection('groups').doc(groupId).collection('members').doc(newUserId).get();
            if (newMemberDoc.exists) {
                return res.status(409).send({ error: 'This user is already a member of the group.' });
            }

            const batch = db.batch();
            const memberDocRef = db.collection('groups').doc(groupId).collection('members').doc(newUserId);
            batch.set(memberDocRef, {
                role: 'member',
                joinedAt: FieldValue.serverTimestamp(),
                name: `${newUserProfile.firstName || ''} ${newUserProfile.lastName || ''}`.trim() || newUserProfile.username,
                profileImageUrl: newUserProfile.profileImageUrl || '',
            });

            const userDocRef = db.collection('users').doc(newUserId);
            batch.update(userDocRef, { groupIds: FieldValue.arrayUnion(groupId) });

            const userConversationRef = db.collection('users').doc(newUserId).collection('conversations').doc(groupId);
            batch.set(userConversationRef, {
                name: groupData?.name,
                profileImageUrl: groupData?.coverImage || '',
                type: 'group',
                timestamp: FieldValue.serverTimestamp(),
                lastMessage: `You have been added to the group.`,
                unreadCount: 0 // --- UNREAD COUNT ---
            });
            
            await batch.commit();
            
            // Send notification to the new member
            const requesterProfile = (await db.collection('users').doc(requesterId).get()).data() as User;
            const requesterName = `${requesterProfile.firstName || ''} ${requesterProfile.lastName || ''}`.trim() || requesterProfile.username;
            
            try {
                await sendGroupInviteNotification(
                    newUserId,
                    groupId,
                    groupData?.name || 'Group',
                    requesterName
                );
            } catch (notifError) {
                console.error('Error sending group invite notification:', notifError);
                // Don't fail the request if notification fails
            }
            
            res.status(200).send({ message: 'Member added successfully.' });

        } catch (error) {
            console.error("Error adding member:", error);
            res.status(500).send({ error: 'Failed to add member to the group.' });
        }
    };

    export const getMyGroups = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const userId = req.user!.uid;
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).send({ error: 'User not found' });
        }
        const userData = userDoc.data();
        const groupIds: string[] = userData?.groupIds || [];
        if (groupIds.length === 0) {
            return res.status(200).json([]);
        }

        const allGroups: any[] = [];
        const chunkSize = 10;
        const fieldPath = admin.firestore.FieldPath.documentId();

        for (let i = 0; i < groupIds.length; i += chunkSize) {
            const chunk = groupIds.slice(i, i + chunkSize);
            const groupsQuery = db
                .collection('groups')
                .where(fieldPath, 'in', chunk);
            const querySnapshot = await groupsQuery.get();
            
            // Fetch member counts for all groups in parallel
            const groupPromises = querySnapshot.docs.map(async (doc) => {
                try {
                    const membersSnapshot = await db.collection('groups').doc(doc.id).collection('members').get();
                    const memberCount = membersSnapshot.size;
                    return { id: doc.id, ...doc.data(), memberCount };
                } catch (error) {
                    // If member count fetch fails, default to 0
                    console.error(`Error fetching member count for group ${doc.id}:`, error);
                    return { id: doc.id, ...doc.data(), memberCount: 0 };
                }
            });
            
            const groupsWithMembers = await Promise.all(groupPromises);
            allGroups.push(...groupsWithMembers);
        }

        res.status(200).json(allGroups);
    } catch (error) {
        console.error("Error fetching groups:", error);
        res.status(500).send({ error: 'Failed to fetch groups.' });
    }
    };
    export const getGroupDetails = async (req: Request, res: Response) => {
        try {
            if (!db) {
                return res.status(500).send({ error: 'Database not initialized.' });
            }

            const groupId = req.params.groupId;
            const groupDoc = await db.collection('groups').doc(groupId).get();
            if (!groupDoc.exists) {
                return res.status(404).send({ error: 'Group not found.' });
            }
            
            // Fetch member count
            const membersSnapshot = await db.collection('groups').doc(groupId).collection('members').get();
            const memberCount = membersSnapshot.size;
            
            res.status(200).json({ 
                id: groupDoc.id, 
                ...groupDoc.data(),
                memberCount 
            });
        } catch (error) {
            console.error("Error fetching group details:", error);
            res.status(500).send({ error: 'Failed to fetch group details.' });
        }
    };
    export const getGroupMembers = async (req: Request, res: Response) => {
        try {
            if (!db) {
                return res.status(500).send({ error: 'Database not initialized.' });
            }

            const groupId = req.params.groupId;
            const membersSnapshot = await db.collection('groups').doc(groupId).collection('members').get();
            const members = membersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            res.status(200).json(members);
        } catch (error) {
            console.error("Error fetching group members:", error);
            res.status(500).send({ error: 'Failed to fetch group members.' });
        }
    };
    export const getGroupMessages = async (req: Request, res: Response) => {
        try {
            if (!db) {
                return res.status(500).send({ error: 'Database not initialized.' });
            }

            const groupId = req.params.groupId;
            const messagesSnapshot = await db.collection('groups').doc(groupId).collection('messages').orderBy('createdAt', 'asc').get();
            const messages = messagesSnapshot.docs.map(doc => {
                const data = doc.data();
                const ts = data.createdAt;
                let createdAtIso: string;
                if (ts && typeof ts.toDate === 'function') {
                    createdAtIso = ts.toDate().toISOString();
                } else if (ts instanceof Date) {
                    createdAtIso = ts.toISOString();
                } else if (ts) {
                    createdAtIso = new Date(ts).toISOString();
                } else {
                    createdAtIso = new Date().toISOString();
                }
                return {
                    id: doc.id,
                    ...data,
                    createdAt: createdAtIso,
                };
            });
            res.status(200).json(messages);
        } catch (error) {
            console.error("Error fetching messages:", error);
            res.status(500).send({ error: 'Failed to fetch messages.' });
        }
    };
    export const joinGroup = async (req: Request, res: Response) => {
        const { inviteCode } = req.body;
        const userId = req.user!.uid;
        if (!inviteCode) { return res.status(400).send({ error: 'Invite code is required.' }); }
        try {
            if (!db) {
                return res.status(500).send({ error: 'Database not initialized.' });
            }

            const groupsQuery = db.collection('groups').where('inviteCode', '==', inviteCode.toUpperCase()).limit(1);
            const querySnapshot = await groupsQuery.get();
            if (querySnapshot.empty) { return res.status(404).send({ error: 'Invalid invite code. Group not found.' }); }
            const groupDoc = querySnapshot.docs[0];
            const groupId = groupDoc.id;
            const groupData = groupDoc.data();
            const memberDocRef = db.collection('groups').doc(groupId).collection('members').doc(userId);
            const memberDoc = await memberDocRef.get();
            if (memberDoc.exists) { return res.status(409).send({ error: 'You are already a member of this group.' }); }
            const userDocRef = db.collection('users').doc(userId);
            const userDoc = await userDocRef.get();
            if (!userDoc.exists) { return res.status(404).send({ error: 'Your user profile was not found.' }); }
            const userProfile = userDoc.data() as User;
            const batch = db.batch();
            batch.set(memberDocRef, { role: 'member', joinedAt: FieldValue.serverTimestamp(), name: `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || userProfile.username, profileImageUrl: userProfile.profileImageUrl || '' });
            batch.update(userDocRef, { groupIds: FieldValue.arrayUnion(groupId) });
            const userConversationRef = db.collection('users').doc(userId).collection('conversations').doc(groupId);
            batch.set(userConversationRef, {
                name: groupData.name,
                profileImageUrl: groupData.coverImage || '',
                type: 'group',
                timestamp: FieldValue.serverTimestamp(),
                lastMessage: `You have joined the group.`,
                unreadCount: 0 // --- UNREAD COUNT ---
            });
            await batch.commit();
            
            // Notify group admins about new member (optional - can be removed if not needed)
            try {
                const membersSnapshot = await db.collection('groups').doc(groupId).collection('members').get();
                const adminIds = membersSnapshot.docs
                    .filter(doc => doc.data().role === 'admin' && doc.id !== userId)
                    .map(doc => doc.id);
                
                if (adminIds.length > 0) {
                    const userName = `${userProfile.firstName || ''} ${userProfile.lastName || ''}`.trim() || userProfile.username;
                    await sendMessageNotification(
                        adminIds[0], // Notify first admin
                        userName,
                        `joined "${groupData.name}"`,
                        undefined,
                        groupId
                    );
                }
            } catch (notifError) {
                console.error('Error sending join notification:', notifError);
                // Don't fail the request if notification fails
            }
            
            res.status(200).send({ message: 'Successfully joined group!', group: { id: groupId, ...groupData } });
        } catch (error) {
            console.error("Error joining group:", error);
            res.status(500).send({ error: 'Could not join the group.' });
        }
    };
    export const updateMemberRole = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const { groupId, memberId } = req.params;
        const { role } = req.body;
        const requesterId = req.user!.uid;
        const requesterDoc = await db.collection('groups').doc(groupId).collection('members').doc(requesterId).get();
        if (!requesterDoc.exists || requesterDoc.data()?.role !== 'admin') {
        return res.status(403).send({ error: 'Only admins can change roles.' });
        }
        const memberDocRef = db.collection('groups').doc(groupId).collection('members').doc(memberId);
        await memberDocRef.update({ role });
        res.status(200).send({ message: 'Member role updated successfully.' });
    } catch (error) {
        console.error("Error updating member role:", error);
        res.status(500).send({ error: 'Failed to update member role.' });
    }
    };
    export const removeMember = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const { groupId, memberId } = req.params;
        const requesterId = req.user!.uid;
        const requesterDoc = await db
            .collection('groups')
            .doc(groupId)
            .collection('members')
            .doc(requesterId)
            .get();
        if (!requesterDoc.exists || requesterDoc.data()?.role !== 'admin') {
        return res.status(403).send({ error: 'Only admins can remove members.' });
        }

        const batch = db.batch();
        const memberDocRef = db.collection('groups').doc(groupId).collection('members').doc(memberId);
        batch.delete(memberDocRef);

        const userDocRef = db.collection('users').doc(memberId);
        batch.update(userDocRef, { groupIds: FieldValue.arrayRemove(groupId) });

        const conversationRef = userDocRef.collection('conversations').doc(groupId);
        batch.delete(conversationRef);

        await batch.commit();

        res.status(200).send({ message: 'Member removed successfully.' });
    } catch (error) {
        console.error("Error removing member:", error);
        res.status(500).send({ error: 'Failed to remove member.' });
    }
    };

    // --- NEW: Update Group Function ---
export const updateGroup = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const groupId = req.params.groupId;
        const userId = req.user!.uid;
        const updateData = req.body;

        // Check if user is admin of the group
        const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
        if (!memberDoc.exists || memberDoc.data()?.role !== 'admin') {
            return res.status(403).send({ error: 'Only group admins can update group settings.' });
        }

        // Update the group
        await db.collection('groups').doc(groupId).update({
            ...updateData,
            updatedAt: FieldValue.serverTimestamp()
        });

        res.status(200).send({ message: 'Group updated successfully.' });
    } catch (error) {
        console.error("Error updating group:", error);
        res.status(500).send({ error: 'Failed to update group.' });
    }
};

// --- NEW: Delete Group Function ---
export const deleteGroup = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const groupId = req.params.groupId;
        const userId = req.user!.uid;

        // Check if user is admin of the group
        const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
        if (!memberDoc.exists || memberDoc.data()?.role !== 'admin') {
            return res.status(403).send({ error: 'Only group admins can delete the group.' });
        }

        // Get all members to remove group from their conversations
        const groupRef = db.collection('groups').doc(groupId);
        const membersSnapshot = await groupRef.collection('members').get();
        const messagesSnapshot = await groupRef.collection('messages').get();
        const batch = db.batch();

        // Remove group from all members' conversations and groupIds
        membersSnapshot.docs.forEach(memberDoc => {
            const memberId = memberDoc.id;
            const userRef = db!.collection('users').doc(memberId);
            const conversationRef = userRef.collection('conversations').doc(groupId);
            
            batch.update(userRef, { groupIds: FieldValue.arrayRemove(groupId) });
            batch.delete(conversationRef);
        });

        // Delete all member and message documents in the group subcollections
        membersSnapshot.docs.forEach(doc => batch.delete(doc.ref));
        messagesSnapshot.docs.forEach(doc => batch.delete(doc.ref));

        // Delete the group document itself
        batch.delete(groupRef);

        await batch.commit();
        res.status(200).send({ message: 'Group deleted successfully.' });
    } catch (error) {
        console.error("Error deleting group:", error);
        res.status(500).send({ error: 'Failed to delete group.' });
    }
};

// --- NEW: Leave Group Function ---
export const leaveGroup = async (req: Request, res: Response) => {
    try {
        if (!db) {
            return res.status(500).send({ error: 'Database not initialized.' });
        }

        const groupId = req.params.groupId;
        const userId = req.user!.uid;

        // Check if user is a member of the group
        const memberDoc = await db.collection('groups').doc(groupId).collection('members').doc(userId).get();
        if (!memberDoc.exists) {
            return res.status(404).send({ error: 'You are not a member of this group.' });
        }

        const memberData = memberDoc.data();
        if (memberData?.role === 'admin') {
            // Check if this is the only admin
            const adminMembers = await db.collection('groups').doc(groupId).collection('members')
                .where('role', '==', 'admin')
                .get();
            
            if (adminMembers.size === 1) {
                return res.status(400).send({ error: 'Cannot leave group as the only admin. Please delete the group or assign another admin first.' });
            }
        }

        const batch = db.batch();

        // Remove user from group members
        batch.delete(memberDoc.ref);

        // Remove group from user's conversations and groupIds
        const userRef = db.collection('users').doc(userId);
        const conversationRef = userRef.collection('conversations').doc(groupId);
        
        batch.update(userRef, { groupIds: FieldValue.arrayRemove(groupId) });
        batch.delete(conversationRef);

        await batch.commit();
        res.status(200).send({ message: 'Successfully left the group.' });
    } catch (error) {
        console.error("Error leaving group:", error);
        res.status(500).send({ error: 'Failed to leave group.' });
    }
};

