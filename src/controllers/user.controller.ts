// server/src/controllers/user.controller.ts

import { Request, Response } from 'express';
import { db, auth } from '../config/firebase';
import { User } from '../../../shared/schema';
import { FieldValue } from 'firebase-admin/firestore';

// Get current user profile
export const getCurrentUser = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.uid;
        const userDoc = await db.collection('users').doc(userId).get();
        
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found.' });
        }
        
        const userData = userDoc.data() as User;
        res.status(200).json({
            id: userDoc.id,
            username: userData.username,
            email: userData.email,
            firstName: userData.firstName || null,
            lastName: userData.lastName || null,
            bio: userData.bio || null,
            profileImageUrl: userData.profileImageUrl || null,
            role: userData.role,
            createdAt: userData.createdAt,
        });
    } catch (error) {
        console.error("Error fetching current user:", error);
        res.status(500).json({ error: 'Failed to fetch user profile.' });
    }
};

// Update user profile
export const updateUserProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.uid;
        const { firstName, lastName, bio } = req.body;
        
        const updates: any = {};

        // Basic validation and normalization for profile fields
        if (firstName !== undefined) {
            if (typeof firstName !== 'string') {
                return res.status(400).json({ error: 'First name must be a string.' });
            }
            const trimmed = firstName.trim();
            if (trimmed.length > 50) {
                return res.status(400).json({ error: 'First name must be at most 50 characters long.' });
            }
            updates.firstName = trimmed;
        }

        if (lastName !== undefined) {
            if (typeof lastName !== 'string') {
                return res.status(400).json({ error: 'Last name must be a string.' });
            }
            const trimmed = lastName.trim();
            if (trimmed.length > 50) {
                return res.status(400).json({ error: 'Last name must be at most 50 characters long.' });
            }
            updates.lastName = trimmed;
        }

        if (bio !== undefined) {
            if (typeof bio !== 'string') {
                return res.status(400).json({ error: 'Bio must be a string.' });
            }
            const trimmed = bio.trim();
            // Limit bio length to prevent excessively large documents
            if (trimmed.length > 1000) {
                return res.status(400).json({ error: 'Bio must be at most 1000 characters long.' });
            }
            updates.bio = trimmed;
        }
        
        // Handle profile image upload - Store as base64 data URL
        if (req.file) {
            try {
                // Check file size (limit to 5MB for base64 storage)
                const maxSize = 5 * 1024 * 1024; // 5MB
                if (req.file.size > maxSize) {
                    return res.status(400).json({ 
                        error: 'Image is too large. Please use an image smaller than 5MB.' 
                    });
                }
                
                // Convert image to base64 data URL
                const base64Image = req.file.buffer.toString('base64');
                const dataUrl = `data:${req.file.mimetype};base64,${base64Image}`;
                
                updates.profileImageUrl = dataUrl;
                console.log('✅ Profile image converted to base64 successfully');
            } catch (uploadError: any) {
                console.error('Error processing profile image:', uploadError.message);
                return res.status(400).json({ 
                    error: 'Could not process profile image.',
                    message: uploadError.message 
                });
            }
        }
        
        updates.updatedAt = FieldValue.serverTimestamp();
        
        await db.collection('users').doc(userId).update(updates);
        
        // Fetch updated user data
        const updatedUserDoc = await db.collection('users').doc(userId).get();
        const userData = updatedUserDoc.data() as User;
        
        res.status(200).json({
            message: 'Profile updated successfully.',
            user: {
                id: updatedUserDoc.id,
                ...userData
            }
        });
    } catch (error: any) {
        console.error("Error updating profile:", error);
        res.status(500).json({ error: error.message || 'Failed to update profile.' });
    }
};

// Change password
export const changePassword = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.uid;
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required.' });
        }
        
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
        }
        
        // Get user's email (used to verify currentPassword)
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            return res.status(404).json({ error: 'User not found.' });
        }
        
        const userData = userDoc.data() as User;

        const email = userData.email;
        if (!email) {
            return res.status(400).json({ error: 'User email is missing; cannot verify password.' });
        }

        const apiKey = process.env.FIREBASE_WEB_API_KEY || process.env.FIREBASE_API_KEY;
        if (!apiKey) {
            console.error('FIREBASE_WEB_API_KEY / FIREBASE_API_KEY is not configured');
            return res.status(500).json({ error: 'Password change is not configured on the server.' });
        }

        // Verify current password via Firebase Auth REST API
        const verifyResponse = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password: currentPassword,
                    returnSecureToken: false,
                }),
            }
        );

        if (!verifyResponse.ok) {
            return res.status(400).json({ error: 'Current password is incorrect.' });
        }

        try {
            // Update password using Firebase Admin SDK after verifying current password
            await auth.updateUser(userId, {
                password: newPassword,
            });

            res.status(200).json({ message: 'Password updated successfully.' });
        } catch (authError) {
            console.error("Error updating password:", authError);
            res.status(500).json({ error: 'Failed to update password.' });
        }
    } catch (error) {
        console.error("Error changing password:", error);
        res.status(500).json({ error: 'Failed to change password.' });
    }
};

// Delete user account
export const deleteAccount = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.uid;
        
        const userDocRef = db.collection('users').doc(userId);
        const userDoc = await userDocRef.get();
        const userData = userDoc.exists ? (userDoc.data() as User) : null;

        // Delete user from Firebase Auth
        await auth.deleteUser(userId);
        
        // Delete user document from Firestore
        await userDocRef.delete();
        
        // Delete username mapping if we have it
        if (userData?.username) {
            await db
                .collection('usernames')
                .doc(userData.username.toLowerCase())
                .delete();
        }
        
        res.status(200).json({ message: 'Account deleted successfully.' });
    } catch (error) {
        console.error("Error deleting account:", error);
        res.status(500).json({ error: 'Failed to delete account.' });
    }
};

// Get user activity - Optimized for fast performance
export const getUserActivity = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.uid;
        
        const activities: any[] = [];
        
        // Fetch user document first to get user name
        const userDoc = await db.collection('users').doc(userId).get();
        const userData = userDoc.exists ? userDoc.data() : null;
        const userName = userData ? `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.username || 'User' : 'User';
        
        // Fetch only recent sessions (limit 5 for performance)
        const sessionsSnapshot = await db.collection('sessions')
            .where('creatorId', '==', userId)
            .orderBy('createdAt', 'desc')
            .limit(5)
            .get()
            .catch(() => null);
        
        // Process sessions - no additional queries for group names for speed
        if (sessionsSnapshot && !sessionsSnapshot.empty) {
            sessionsSnapshot.forEach(sessionDoc => {
                const sessionData = sessionDoc.data();
                activities.push({
                    type: 'study_session',
                    title: `${userName} created session "${sessionData.title}"`,
                    description: `Created a study session`,
                    timestamp: sessionData.createdAt || sessionData.startTime,
                    icon: 'calendar'
                });
            });
        }
        
        // Process only first 5 groups for performance
        if (userData && userData.groupIds && Array.isArray(userData.groupIds) && userData.groupIds.length > 0) {
            // Fetch only first 5 groups
            const groupIds = userData.groupIds.slice(0, 5);
            
            // Fetch all group and member docs in parallel for better performance
            const groupPromises = groupIds.map((groupId: string) => 
                db.collection('groups').doc(groupId).get().catch(() => null)
            );
            const memberPromises = groupIds.map((groupId: string) => 
                db.collection('groups').doc(groupId).collection('members').doc(userId).get().catch(() => null)
            );
            
            const [groupDocs, memberDocs] = await Promise.all([
                Promise.all(groupPromises),
                Promise.all(memberPromises)
            ]);
            
            // Process results
            for (let i = 0; i < groupIds.length; i++) {
                const groupDoc = groupDocs[i];
                const memberDoc = memberDocs[i];
                
                if (groupDoc && groupDoc.exists && memberDoc && memberDoc.exists) {
                    const groupData = groupDoc.data();
                    const memberData = memberDoc.data();
                    const groupName = groupData?.name || 'Study Group';
                    const isCreator = groupData?.creatorId === userId;
                    
                    activities.push({
                        type: isCreator ? 'group_create' : 'group_join',
                        title: isCreator 
                            ? `${userName} created group "${groupName}"` 
                            : `${userName} joined group "${groupName}"`,
                        description: isCreator 
                            ? `Created a new ${groupData?.privacy || 'public'} study group`
                            : `Joined as a ${memberData?.role || 'member'}`,
                        timestamp: isCreator ? groupData?.createdAt : memberData?.joinedAt,
                        icon: 'users'
                    });
                }
            }
        }
        
        // Sort by timestamp (most recent first)
        activities.sort((a, b) => {
            const getTime = (timestamp: any) => {
                if (!timestamp) return 0;
                if (timestamp.toDate) return timestamp.toDate().getTime();
                if (timestamp._seconds) return timestamp._seconds * 1000;
                return new Date(timestamp).getTime();
            };
            return getTime(b.timestamp) - getTime(a.timestamp);
        });
        
        // Return top 8 activities
        res.status(200).json(activities.slice(0, 8));
    } catch (error) {
        console.error("Error fetching user activity:", error);
        // Return empty array instead of error to prevent dashboard from breaking
        res.status(200).json([]);
    }
};

// ... searchUsers function (no changes)
export const searchUsers = async (req: Request, res: Response) => {
    try {
        const { query } = req.query;
        const currentUserId = req.user!.uid;

        if (!query || typeof query !== 'string' || query.trim().length < 3) {
            return res.status(400).json({ error: 'A search query of at least 3 characters is required.' });
        }

        const searchQuery = query.toLowerCase();
        const usernameQuery = db.collection('users').where('username', '>=', searchQuery).where('username', '<=', searchQuery + '\uf8ff');
        const emailQuery = db.collection('users').where('email', '>=', searchQuery).where('email', '<=', searchQuery + '\uf8ff');

        const [usernameSnapshot, emailSnapshot] = await Promise.all([
            usernameQuery.get(),
            emailQuery.get(),
        ]);

        const usersMap = new Map();
        const processDoc = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
            if (doc.id !== currentUserId) {
                const data = doc.data();
                usersMap.set(doc.id, {
                    id: doc.id,
                    name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.username,
                    username: data.username,
                    email: data.email,
                    profileImageUrl: data.profileImageUrl || null,
                });
            }
        };

        usernameSnapshot.forEach(processDoc);
        emailSnapshot.forEach(processDoc);

        res.status(200).json(Array.from(usersMap.values()));
    } catch (error) {
        console.error("Error searching users:", error);
        res.status(500).send({ error: 'Failed to search for users.' });
    }
};


// ... sendFriendRequest function (small change)
export const sendFriendRequest = async (req: Request, res: Response) => {
    try {
        const senderId = req.user!.uid;
        const { receiverId } = req.body;

        if (senderId === receiverId) {
            return res.status(400).send({ error: "You cannot send a friend request to yourself." });
        }

        const senderDoc = await db.collection('users').doc(senderId).get();
        if (!senderDoc.exists) {
            return res.status(404).send({ error: 'Your user profile was not found.' });
        }
        const senderProfile = senderDoc.data() as User;

        const requestRef = db.collection('users').doc(receiverId).collection('friendRequests').doc(senderId);

        await requestRef.set({
            senderId: senderId,
            senderName: `${senderProfile.firstName || ''} ${senderProfile.lastName || ''}`.trim() || senderProfile.username,
            senderProfileImageUrl: senderProfile.profileImageUrl || '',
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(), // CORRECTED: Use FieldValue
        });

        res.status(200).send({ message: 'Friend request sent successfully.' });
    } catch (error) {
        console.error("Error sending friend request:", error);
        res.status(500).send({ error: 'Failed to send friend request.' });
    }
};


// ... getFriendRequests function (no changes)
export const getFriendRequests = async (req: Request, res: Response) => {
    try {
        const userId = req.user!.uid;
        const requestsSnapshot = await db.collection('users').doc(userId).collection('friendRequests').where('status', '==', 'pending').get();
        const requests = requestsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(requests);
    } catch (error) {
        console.error("Error fetching friend requests:", error);
        res.status(500).send({ error: 'Failed to fetch friend requests.' });
    }
};


// ... respondToFriendRequest function (small change)
export const respondToFriendRequest = async (req: Request, res: Response) => {
    try {
        const receiverId = req.user!.uid;
        const { senderId } = req.params;
        const { response } = req.body;

        const requestRef = db.collection('users').doc(receiverId).collection('friendRequests').doc(senderId);

        if (response === 'accept') {
            const receiverDoc = await db.collection('users').doc(receiverId).get();
            const senderDoc = await db.collection('users').doc(senderId).get();

            if (!receiverDoc.exists || !senderDoc.exists) {
                return res.status(404).send({ error: 'User profile not found.' });
            }
            const receiverProfile = receiverDoc.data() as User;
            const senderProfile = senderDoc.data() as User;

            const batch = db.batch();

            const receiverConversationRef = db.collection('users').doc(receiverId).collection('conversations').doc(senderId);
            batch.set(receiverConversationRef, {
                name: `${senderProfile.firstName || ''} ${senderProfile.lastName || ''}`.trim() || senderProfile.username,
                profileImageUrl: senderProfile.profileImageUrl || '',
                type: 'dm',
                timestamp: FieldValue.serverTimestamp(), // CORRECTED: Use FieldValue
                lastMessage: 'You are now friends!'
            });

            const senderConversationRef = db.collection('users').doc(senderId).collection('conversations').doc(receiverId);
            batch.set(senderConversationRef, {
                name: `${receiverProfile.firstName || ''} ${receiverProfile.lastName || ''}`.trim() || receiverProfile.username,
                profileImageUrl: receiverProfile.profileImageUrl || '',
                type: 'dm',
                timestamp: FieldValue.serverTimestamp(), // CORRECTED: Use FieldValue
                lastMessage: 'You are now friends!'
            });

            batch.delete(requestRef);
            
            await batch.commit();
            res.status(200).send({ message: 'Friend request accepted.' });

        } else if (response === 'decline') {
            await requestRef.delete();
            res.status(200).send({ message: 'Friend request declined.' });
        } else {
            res.status(400).send({ error: 'Invalid response.' });
        }
    } catch (error) {
        console.error("Error responding to friend request:", error);
        res.status(500).send({ error: 'Failed to respond to friend request.' });
    }
};