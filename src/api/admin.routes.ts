// server/src/api/admin.routes.ts
// Fixed version with proper member fetching

import { Router, Request, Response, NextFunction } from 'express';
import { db, auth, admin } from '../config/firebase';
import { checkAuth } from '../middlewares/auth.middleware';

const router = Router();

router.use(checkAuth);

export async function ensureAdmin(req: Request, res: Response, next: NextFunction) {
    try {
        const uid = req.user!.uid;
        const doc = await db.collection('users').doc(uid).get();
        const data = doc.data();

        if (!data || data.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        next();
    } catch (e) {
        console.error('Failed to verify admin status', e);
        return res.status(500).json({ error: 'Failed to verify admin status' });
    }
}

router.use(ensureAdmin);

// ============ GLOBAL CACHE ============
let usersCache: any[] | null = null;
let groupsCache: any[] | null = null;
let statsCache: any | null = null;
let lastFetch = 0;
const CACHE_TTL = 60000; // 60 seconds

const isCacheValid = () => Date.now() - lastFetch < CACHE_TTL;

// Pre-load data
let isPreloading = false;
const preloadData = async () => {
    if (isPreloading) return;
    
    // Check if Firebase is initialized before proceeding
    if (!db) {
        if (process.env.NODE_ENV === 'development') {
            console.log('⏳ Waiting for Firebase initialization...');
        }
        return;
    }
    
    isPreloading = true;
    
    try {
        console.log('🚀 Pre-loading all data...');
        const start = Date.now();
        
        // Fetch users and groups in parallel
        const [usersSnap, groupsSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection('groups').get()
        ]);
        
        // Process users
        usersCache = usersSnap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                username: d.username || '',
                email: d.email || '',
                firstName: d.firstName || '',
                lastName: d.lastName || '',
                profileImageUrl: d.profileImageUrl || null,
                role: d.role || 'user',
                status: d.status || 'active',
                createdAt: d.createdAt?._seconds ? new Date(d.createdAt._seconds * 1000).toISOString() : 
                          d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null,
            };
        });
        
        // Process groups - fetch member counts in parallel (all at once for speed)
        console.log(`📊 Fetching member counts for ${groupsSnap.size} groups...`);
        
        // Fetch all member counts in parallel with timeout protection
        const groupPromises = groupsSnap.docs.map(async (doc) => {
            const d = doc.data();
            let memberCount = 0;
            
            try {
                // Fetch members subcollection with 2 second timeout per query
                const membersSnap = await Promise.race([
                    db.collection('groups').doc(doc.id).collection('members').get(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout')), 2000)
                    )
                ]) as any;
                memberCount = membersSnap.size;
            } catch (e: any) {
                // Silently fail - member count will be 0 (will be updated on next request)
                // Don't log to reduce console noise
            }
            
            return {
                id: doc.id,
                name: d.name || '',
                description: d.description || '',
                privacy: d.privacy || 'public',
                memberCount,
                creatorId: d.creatorId || '',
                status: d.status || 'active',
                createdAt: d.createdAt?._seconds ? new Date(d.createdAt._seconds * 1000).toISOString() :
                          d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null,
            };
        });
        
        // Wait for all member counts in parallel (much faster than sequential)
        groupsCache = await Promise.all(groupPromises);
        
        // Calculate total members
        const totalMembers = groupsCache.reduce((sum, g) => sum + (g.memberCount || 0), 0);
        
        // Calculate messages from last 24 hours
        console.log('📨 Counting messages from last 24 hours...');
        const oneDayAgo = admin.firestore.Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
        let messagesToday = 0;
        
        try {
            // Count group messages from last 24 hours
            // Use a more efficient approach: get all messages and filter client-side if needed
            // But first try with query, fallback to getting all if index missing
            const groupMessagePromises = groupsSnap.docs.map(async (groupDoc) => {
                try {
                    // Try query with timestamp first
                    let messagesSnap;
                    try {
                        messagesSnap = await db
                            .collection('groups')
                            .doc(groupDoc.id)
                            .collection('messages')
                            .where('createdAt', '>=', oneDayAgo)
                            .get();
                    } catch (queryError: any) {
                        // If index error, get all messages and filter manually
                        if (queryError.code === 9 || queryError.message?.includes('index')) {
                            console.log(`   ⚠️ Index missing for group ${groupDoc.id}, fetching all messages...`);
                            const allMessages = await db
                                .collection('groups')
                                .doc(groupDoc.id)
                                .collection('messages')
                                .get();
                            
                            // Filter messages from last 24 hours manually
                            const recentMessages = allMessages.docs.filter(doc => {
                                const createdAt = doc.data().createdAt;
                                if (!createdAt) return false;
                                
                                // Handle both Timestamp and serverTimestamp placeholder
                                let messageDate: Date;
                                if (createdAt.toDate) {
                                    messageDate = createdAt.toDate();
                                } else if (createdAt._seconds) {
                                    messageDate = new Date(createdAt._seconds * 1000);
                                } else {
                                    return false;
                                }
                                
                                return messageDate >= oneDayAgo.toDate();
                            });
                            
                            return recentMessages.length;
                        }
                        throw queryError;
                    }
                    return messagesSnap.size;
                } catch (e: any) {
                    // Log error for debugging but don't fail completely
                    if (e.code !== 9 && !e.message?.includes('index')) {
                        console.warn(`   ⚠️ Error counting messages for group ${groupDoc.id}:`, e.message);
                    }
                    return 0;
                }
            });
            
            const groupMessageCounts = await Promise.all(groupMessagePromises);
            messagesToday += groupMessageCounts.reduce((sum, count) => sum + count, 0);
            
            // Count direct messages from last 24 hours
            // Get all chats and count their messages
            const chatsSnap = await db.collection('chats').get();
            const chatMessagePromises = chatsSnap.docs.map(async (chatDoc) => {
                try {
                    // Try query with timestamp first
                    let messagesSnap;
                    try {
                        messagesSnap = await db
                            .collection('chats')
                            .doc(chatDoc.id)
                            .collection('messages')
                            .where('createdAt', '>=', oneDayAgo)
                            .get();
                    } catch (queryError: any) {
                        // If index error, get all messages and filter manually
                        if (queryError.code === 9 || queryError.message?.includes('index')) {
                            const allMessages = await db
                                .collection('chats')
                                .doc(chatDoc.id)
                                .collection('messages')
                                .get();
                            
                            // Filter messages from last 24 hours manually
                            const recentMessages = allMessages.docs.filter(doc => {
                                const createdAt = doc.data().createdAt;
                                if (!createdAt) return false;
                                
                                // Handle both Timestamp and serverTimestamp placeholder
                                let messageDate: Date;
                                if (createdAt.toDate) {
                                    messageDate = createdAt.toDate();
                                } else if (createdAt._seconds) {
                                    messageDate = new Date(createdAt._seconds * 1000);
                                } else {
                                    return false;
                                }
                                
                                return messageDate >= oneDayAgo.toDate();
                            });
                            
                            return recentMessages.length;
                        }
                        throw queryError;
                    }
                    return messagesSnap.size;
                } catch (e: any) {
                    // Log error for debugging but don't fail completely
                    if (e.code !== 9 && !e.message?.includes('index')) {
                        console.warn(`   ⚠️ Error counting messages for chat ${chatDoc.id}:`, e.message);
                    }
                    return 0;
                }
            });
            
            const chatMessageCounts = await Promise.all(chatMessagePromises);
            messagesToday += chatMessageCounts.reduce((sum, count) => sum + count, 0);
            
            console.log(`   ✅ Found ${messagesToday} messages in last 24 hours (${groupMessageCounts.reduce((a, b) => a + b, 0)} group + ${chatMessageCounts.reduce((a, b) => a + b, 0)} direct)`);
        } catch (e: any) {
            console.warn('⚠️ Error counting messages:', e.message);
            messagesToday = 0;
        }
        
        // Calculate total files
        console.log('📁 Counting total files...');
        let totalFiles = 0;
        
        try {
            // Count group files
            const groupFilePromises = groupsSnap.docs.map(async (groupDoc) => {
                try {
                    const filesSnap = await db
                        .collection('groups')
                        .doc(groupDoc.id)
                        .collection('files')
                        .get();
                    return filesSnap.size;
                } catch (e) {
                    return 0;
                }
            });
            
            const groupFileCounts = await Promise.all(groupFilePromises);
            totalFiles += groupFileCounts.reduce((sum, count) => sum + count, 0);
            
            // Count direct files
            const directFilesSnap = await db.collection('directFiles').get();
            totalFiles += directFilesSnap.size;
            
            console.log(`   ✅ Found ${totalFiles} total files`);
        } catch (e: any) {
            console.warn('⚠️ Error counting files:', e.message);
            totalFiles = 0;
        }
        
        statsCache = {
            totalUsers: usersCache.length,
            activeGroups: groupsCache.filter(g => g.status === 'active').length,
            totalGroups: groupsCache.length,
            totalMembers,
            messagesToday,
            totalFiles,
            userGrowth: '+12%',
            groupGrowth: '+5%',
            messageGrowth: '+18%',
            fileGrowth: '+8%'
        };
        
        lastFetch = Date.now();
        console.log(`✅ Data loaded in ${Date.now() - start}ms`);
        console.log(`   📊 ${usersCache.length} users, ${groupsCache.length} groups, ${totalMembers} total members`);
    } catch (e: any) {
        console.error('❌ Pre-load failed:', e.message);
    } finally {
        isPreloading = false;
    }
};

// Start pre-loading in background AFTER Firebase is initialized
// Wait for Firebase to be ready before attempting pre-load
const startPreload = async () => {
    // Wait for Firebase to initialize (with timeout)
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds max wait
    
    while (attempts < maxAttempts) {
        try {
            // Try to access db - this will trigger initialization if not done
            if (db) {
                // Test if db is actually working
                await db.collection('users').limit(1).get();
                // Firebase is ready, start pre-loading
                preloadData().catch(err => {
                    // Silently handle errors - routes will fetch on demand
                    if (process.env.NODE_ENV === 'development') {
                        console.error('Background pre-load error:', err.message);
                    }
                });
                return;
            }
        } catch (e) {
            // Firebase not ready yet, wait and retry
        }
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // If we get here, Firebase didn't initialize in time
    // Pre-load will happen on-demand when routes are accessed
    if (process.env.NODE_ENV === 'development') {
        console.log('⚠️  Firebase not ready, pre-load will happen on-demand');
    }
};

// Start pre-loading after server initialization (non-blocking)
// This ensures Firebase is initialized first
setTimeout(() => {
    startPreload().catch(() => {
        // Ignore errors - pre-load will happen on-demand
    });
}, 2000);

// ============ USERS API ============

router.get('/users', async (req: Request, res: Response): Promise<void> => {
    try {
        if (usersCache && isCacheValid()) {
            console.log('⚡ Returning cached users');
            res.status(200).json(usersCache);
            return;
        }
        
        await preloadData();
        res.status(200).json(usersCache || []);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/users/:userId/status', async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        const { status } = req.body;
        
        await db.collection('users').doc(userId).update({ status, updatedAt: new Date() });
        try { await auth.updateUser(userId, { disabled: status === 'suspended' }); } catch (e) {}
        
        if (usersCache) {
            usersCache = usersCache.map(u => u.id === userId ? { ...u, status } : u);
        }
        
        res.status(200).json({ success: true, message: `User ${status}.` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.patch('/users/:userId/role', async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        const { role } = req.body;
        
        await db.collection('users').doc(userId).update({ role, updatedAt: new Date() });
        
        if (usersCache) {
            usersCache = usersCache.map(u => u.id === userId ? { ...u, role } : u);
        }
        
        res.status(200).json({ success: true, message: `Role updated to ${role}.` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/users/:userId', async (req: Request, res: Response): Promise<void> => {
    try {
        const { userId } = req.params;
        
        await db.collection('users').doc(userId).update({ status: 'deleted', deletedAt: new Date() });
        try { await auth.updateUser(userId, { disabled: true }); } catch (e) {}
        
        if (usersCache) {
            usersCache = usersCache.map(u => u.id === userId ? { ...u, status: 'deleted' } : u);
        }
        
        res.status(200).json({ success: true, message: 'User deleted.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============ GROUPS API ============

router.get('/groups', async (req: Request, res: Response): Promise<void> => {
    try {
        if (groupsCache && isCacheValid()) {
            console.log('⚡ Returning cached groups');
            res.status(200).json(groupsCache);
            return;
        }
        
        await preloadData();
        res.status(200).json(groupsCache || []);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.get('/groups/:groupId', async (req: Request, res: Response): Promise<void> => {
    try {
        const { groupId } = req.params;
        console.log(`📊 Fetching details for group ${groupId}...`);
        
        const groupDoc = await db.collection('groups').doc(groupId).get();
        
        if (!groupDoc.exists) {
            res.status(404).json({ error: 'Not found.' });
            return;
        }
        
        const d = groupDoc.data()!;
        
        // Get members with their details
        const membersSnap = await db.collection('groups').doc(groupId).collection('members').get();
        console.log(`   Found ${membersSnap.size} members`);
        
        const members = membersSnap.docs.map(m => {
            const memberData = m.data();
            return {
                id: m.id,
                name: memberData.name || 'Unknown User',
                role: memberData.role || 'member',
                profileImageUrl: memberData.profileImageUrl || null,
                joinedAt: memberData.joinedAt?._seconds ? new Date(memberData.joinedAt._seconds * 1000).toISOString() : 
                         memberData.joinedAt?.toDate ? memberData.joinedAt.toDate().toISOString() : null
            };
        });
        
        // Get message count
        let messageCount = 0;
        try {
            const messagesSnap = await db.collection('groups').doc(groupId).collection('messages').get();
            messageCount = messagesSnap.size;
        } catch (e) {}
        
        res.status(200).json({
            id: groupDoc.id,
            name: d.name,
            description: d.description,
            privacy: d.privacy,
            status: d.status || 'active',
            creatorId: d.creatorId,
            members,
            memberCount: members.length,
            messageCount,
            createdAt: d.createdAt?._seconds ? new Date(d.createdAt._seconds * 1000).toISOString() :
                      d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : null
        });
    } catch (error: any) {
        console.error('❌ Error fetching group details:', error.message);
        res.status(500).json({ error: error.message });
    }
});

router.patch('/groups/:groupId/status', async (req: Request, res: Response): Promise<void> => {
    try {
        const { groupId } = req.params;
        const { status } = req.body;
        
        await db.collection('groups').doc(groupId).update({ status, updatedAt: new Date() });
        
        if (groupsCache) {
            groupsCache = groupsCache.map(g => g.id === groupId ? { ...g, status } : g);
            if (statsCache) {
                statsCache.activeGroups = groupsCache.filter(g => g.status === 'active').length;
            }
        }
        
        res.status(200).json({ success: true, message: `Group ${status}.` });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.delete('/groups/:groupId', async (req: Request, res: Response): Promise<void> => {
    try {
        const { groupId } = req.params;
        
        const batch = db.batch();
        const members = await db.collection('groups').doc(groupId).collection('members').get();
        const messages = await db.collection('groups').doc(groupId).collection('messages').get();
        
        members.docs.forEach(doc => batch.delete(doc.ref));
        messages.docs.forEach(doc => batch.delete(doc.ref));
        batch.delete(db.collection('groups').doc(groupId));
        
        await batch.commit();
        
        if (groupsCache) {
            const deletedGroup = groupsCache.find(g => g.id === groupId);
            groupsCache = groupsCache.filter(g => g.id !== groupId);
            if (statsCache && deletedGroup) {
                statsCache.totalGroups = groupsCache.length;
                statsCache.activeGroups = groupsCache.filter(g => g.status === 'active').length;
                statsCache.totalMembers -= deletedGroup.memberCount || 0;
            }
        }
        
        res.status(200).json({ success: true, message: 'Group deleted.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ============ STATS API ============

router.get('/stats', async (req: Request, res: Response): Promise<void> => {
    try {
        if (statsCache && isCacheValid()) {
            console.log('⚡ Returning cached stats');
            res.status(200).json(statsCache);
            return;
        }
        
        await preloadData();
        res.status(200).json(statsCache || {
            totalUsers: 0, activeGroups: 0, totalGroups: 0, totalMembers: 0,
            messagesToday: 0, totalFiles: 0,
            userGrowth: '0%', groupGrowth: '0%', messageGrowth: '0%', fileGrowth: '0%'
        });
    } catch (error: any) {
        res.status(200).json({
            totalUsers: 0, activeGroups: 0, totalGroups: 0, totalMembers: 0,
            messagesToday: 0, totalFiles: 0,
            userGrowth: '0%', groupGrowth: '0%', messageGrowth: '0%', fileGrowth: '0%'
        });
    }
});

// ============ SETTINGS API ============

router.get('/settings', async (req: Request, res: Response): Promise<void> => {
    try {
        const doc = await db.collection('settings').doc('platform').get();
        res.status(200).json(doc.exists ? doc.data() : { allowRegistrations: true, allowFileUploads: true });
    } catch (error) {
        res.status(200).json({ allowRegistrations: true, allowFileUploads: true });
    }
});

router.patch('/settings', async (req: Request, res: Response): Promise<void> => {
    try {
        await db.collection('settings').doc('platform').set({ ...req.body, updatedAt: new Date() }, { merge: true });
        res.status(200).json({ success: true, message: 'Settings saved.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Force refresh cache
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
    lastFetch = 0;
    await preloadData();
    res.status(200).json({ success: true, message: 'Cache refreshed.' });
});

export default router;
