/** 通知规则单测：java -cp out NotifyLogicTest（无需 Android 设备） */
import com.maimai.qqchat.NotifyLogic;

public class NotifyLogicTest {
    static int passed = 0;
    static int total = 0;

    static void check(String name, boolean ok, Object detail) {
        total++;
        if (ok) passed++;
        System.out.println((ok ? "PASS  " : "FAIL  ") + name + "  ::  " + detail);
    }

    public static void main(String[] args) {
        // 1) 普通频道：任何消息都推
        check("普通频道收到消息 → 推送", NotifyLogic.shouldNotify(false, false, false), true);
        // 2) 免打扰频道：不推
        check("免打扰频道普通消息 → 不推送", !NotifyLogic.shouldNotify(true, false, false), false);
        // 3) 免打扰 + @机器人 → 推
        check("免打扰频道有人@我 → 推送", NotifyLogic.shouldNotify(true, true, false), true);
        // 4) 免打扰 + 引用了机器人 → 推
        check("免打扰频道引用了我 → 推送", NotifyLogic.shouldNotify(true, false, true), true);
        // 5) 引用判定
        check("引用作者是机器人 → 认作被引用", NotifyLogic.isReplyToBot("4802811276105178826", "4802811276105178826"), true);
        check("引用作者是别人 → 不算被引用", !NotifyLogic.isReplyToBot("529165A1BAA67747785B03632CA926B5", "4802811276105178826"), false);
        check("没有引用信息 → 不算被引用", !NotifyLogic.isReplyToBot("", "4802811276105178826"), false);
        // 6) 标题
        check("标题带频道名", NotifyLogic.notificationTitle("机器人群", "糖糖", false, false).equals("机器人群 · 糖糖"),
            NotifyLogic.notificationTitle("机器人群", "糖糖", false, false));
        check("有人@我时标题有标记", NotifyLogic.notificationTitle("机器人群", "糖糖", true, false).startsWith("[有人@我]"),
            NotifyLogic.notificationTitle("机器人群", "糖糖", true, false));
        check("被引用时标题有标记", NotifyLogic.notificationTitle("机器人群", "糖糖", false, true).startsWith("[被引用]"),
            NotifyLogic.notificationTitle("机器人群", "糖糖", false, true));
        // 7) 内容清洗
        check("图片标签转 [图片]", NotifyLogic.stripHtml("<img src=\"https://x/y.jpg\">").equals("[图片]"),
            NotifyLogic.stripHtml("<img src=\"https://x/y.jpg\">"));
        check("去掉 HTML 与实体", NotifyLogic.stripHtml("<b>你好</b>&amp;欢迎").equals("你好&欢迎"),
            NotifyLogic.stripHtml("<b>你好</b>&amp;欢迎"));
        check("空内容兜底", NotifyLogic.stripHtml("<img src=\"a\">").length() > 0, NotifyLogic.stripHtml(""));

        System.out.println("SUMMARY " + passed + "/" + total);
        if (passed != total) System.exit(1);
    }
}
