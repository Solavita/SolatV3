using System;
using System.Drawing;
using System.Windows.Forms;

internal sealed class SolatComputerUseFixture : Form
{
    private readonly TextBox input;
    private readonly Label status;

    private SolatComputerUseFixture()
    {
        Text = "SOLAT Computer Use Fixture";
        Name = "SolatComputerUseFixture";
        AccessibleName = "SOLAT Computer Use Fixture";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(460, 180);

        input = new TextBox
        {
            Name = "AgentInput",
            AccessibleName = "Agent Input",
            Location = new Point(24, 24),
            Width = 400,
            Text = "idle"
        };

        var apply = new Button
        {
            Name = "ApplyAgentInput",
            AccessibleName = "Apply Agent Input",
            Location = new Point(24, 70),
            Width = 160,
            Text = "Apply"
        };

        status = new Label
        {
            Name = "AgentStatus",
            AccessibleName = "status:idle",
            Location = new Point(24, 120),
            Width = 400,
            Text = "status:idle"
        };

        apply.Click += delegate
        {
            status.Text = "status:" + input.Text;
            status.AccessibleName = status.Text;
        };
        Controls.Add(input);
        Controls.Add(apply);
        Controls.Add(status);
    }

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SolatComputerUseFixture());
    }
}
