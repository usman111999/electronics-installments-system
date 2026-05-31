package com.eis.devicelock.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.eis.devicelock.R
import com.eis.devicelock.ui.theme.EisTheme
import com.eis.devicelock.util.Secrets
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Post-enrollment status screen.
 *
 * Intentionally minimal — the customer is not the operator and we don't
 * want a busy screen they can fiddle with. Just shows that the device is
 * registered and how to reach the branch.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            EisTheme {
                StatusScreen()
            }
        }
    }
}

@Composable
private fun StatusScreen() {
    val ctx = LocalContext.current
    val secrets = Secrets.get(ctx)
    val imei = secrets.get(Secrets.KEY_IMEI).orEmpty()
    val branch = secrets.get(Secrets.KEY_BRANCH_ID).orEmpty()
    val branchPhone = secrets.get(Secrets.KEY_BRANCH_PHONE).orEmpty()
    val lastHb = secrets.getLong(Secrets.KEY_LAST_HEARTBEAT_AT, 0L)
    val lastHbText = if (lastHb == 0L) "—" else
        SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US).format(Date(lastHb))

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Text(ctx.getString(R.string.enroll_success), style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(16.dp))
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors()
        ) {
            Column(Modifier.padding(16.dp)) {
                LabelValue(label = ctx.getString(R.string.main_status_label),
                    value = ctx.getString(R.string.main_status_active))
                LabelValue(label = ctx.getString(R.string.main_imei_label), value = imei)
                LabelValue(label = ctx.getString(R.string.main_branch_label), value = branch)
                LabelValue(label = ctx.getString(R.string.main_last_heartbeat), value = lastHbText)
            }
        }
        Spacer(Modifier.height(16.dp))
        Text(ctx.getString(R.string.main_help_intro))
        if (branchPhone.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                ctx.getString(R.string.enroll_call_branch, branchPhone),
                fontWeight = FontWeight.SemiBold
            )
        }
    }
}

@Composable
private fun LabelValue(label: String, value: String) {
    Text(label, style = MaterialTheme.typography.labelSmall)
    Text(value.ifBlank { "—" }, style = MaterialTheme.typography.bodyLarge)
    Spacer(Modifier.height(8.dp))
}
